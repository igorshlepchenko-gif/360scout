"""
360SCOUT — Live Matches Route
מושך משחקים אמיתיים מ-API-Football, מריץ עליהם את מנוע החיזוי,
ומחבר יחסי הימורים אמיתיים מ-The Odds API.
"""

import os
import asyncio
import logging
import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
from fastapi import APIRouter, BackgroundTasks
import httpx
from dotenv import load_dotenv

load_dotenv()

from app.engine.prediction_model import (
    PredictionEngine, MatchContext, calculate_value, calculate_consensus,
    calculate_under_over_25_edge,
)
from app.engine.dynamic_adjuster import adjust_probabilities, AdjustmentParams
from app.engine.goals_engine import (
    calculate_goals_value, injury_flags_from_list, GoalsValueSignal,
)

# store ידני של overrides לפי fixture_id — נמחק עם restart
_manual_adjustments: dict[int, dict] = {}
from app.cache import get as cache_get, set as cache_set, stats as cache_stats, clear_all as cache_clear_all
from app.db.repository import save_match_prediction, get_track_record, update_match_result

router = APIRouter(prefix="/api/live", tags=["live"])
engine = PredictionEngine()
logger = logging.getLogger(__name__)

API_FOOTBALL_KEY = os.getenv("API_FOOTBALL_KEY", "")
OPENWEATHER_KEY  = os.getenv("OPENWEATHER_KEY", "")
ODDS_API_KEY     = os.getenv("ODDS_API_KEY", "")

API_FOOTBALL_BASE = "https://v3.football.api-sports.io"
ODDS_API_BASE     = "https://api.the-odds-api.com/v4"
OPENWEATHER_BASE  = "https://api.openweathermap.org/data/2.5"

# ליגות לעקוב — ID של API-Football
TRACKED_LEAGUES = [
    {"id": 1,   "name": "מונדיאל 2026",         "season": 2026},
    {"id": 2,   "name": "ליגת האלופות",         "season": 2025},
    {"id": 3,   "name": "ליגה אירופית",         "season": 2025},
    {"id": 39,  "name": "פרמייר ליג",           "season": 2025},
    {"id": 140, "name": "לה ליגה",              "season": 2025},
    {"id": 135, "name": "סרייה א",              "season": 2025},
    {"id": 78,  "name": "בונדסליגה",            "season": 2025},
    {"id": 61,  "name": "ליג 1",                "season": 2025},
    {"id": 71,  "name": "ליגה ברזילאית",        "season": 2025},
    {"id": 253, "name": "MLS",                  "season": 2025},
]

# מיפוי שמות קבוצות ל-Odds API (שמות שונים לפעמים)
TEAM_NAME_MAP = {
    "Manchester United": ["Man United", "Manchester Utd"],
    "Manchester City":   ["Man City"],
    "Atletico Madrid":   ["Atletico de Madrid", "Atletico Mineiro"],
}

# ── Filtering ──────────────────────────────────────────────────────────────────

# Whitelist — league IDs the public feed is allowed to show.
# Anything outside this set is blocked, regardless of data availability.
TRACKED_LEAGUE_IDS: set[int] = {lg["id"] for lg in TRACKED_LEAGUES}

# Minimum decimal odds for the market's shortest-priced outcome.
# If the heavy favourite is below this floor, the match is a near-certainty
# with no meaningful value — skip it even when confidence is high.
MIN_MARKET_ODDS: float = 1.40


def is_premium_league(fixture: dict) -> bool:
    """True only for fixtures whose league.id is in TRACKED_LEAGUE_IDS."""
    return fixture.get("league", {}).get("id") in TRACKED_LEAGUE_IDS


def passes_odds_threshold(match: dict, min_odds: float = MIN_MARKET_ODDS) -> bool:
    """
    True when the cheapest available outcome still clears the minimum floor.

    Logic:
    - Take the three decimal odds (home / draw / away).
    - Discard any that are missing or ≤ 1.0 (invalid).
    - If none remain → no odds data at all → let the match through
      (quota may be exhausted; don't silently drop matches for an API reason).
    - If the smallest valid odd is below min_odds → near-certainty → block.

    Example: home=1.10, draw=5.00, away=12.0 → min=1.10 < 1.40 → blocked.
    Example: home=1.55, draw=3.80, away=5.20 → min=1.55 ≥ 1.40 → allowed.
    """
    odds = match.get("odds")
    if not odds:
        return True
    candidates = [
        float(odds.get("odds_home") or 0),
        float(odds.get("odds_draw") or 0),
        float(odds.get("odds_away") or 0),
    ]
    valid = [o for o in candidates if o > 1.0]
    if not valid:
        return True
    return min(valid) >= min_odds


async def fetch_todays_fixtures(days_ahead: int = 1) -> list:
    """
    משוך משחקים בסדר עדיפויות:
    1. חיים עכשיו
    2. מתוכננים היום
    3. 7 ימים אחורה — כל ליגה שיש בה משחקים
    """
    today = datetime.now().strftime("%Y-%m-%d")
    all_fixtures = []

    async with httpx.AsyncClient(timeout=30) as client:   # 30s for production
        # 1. חיים עכשיו — cache 2 דקות בלבד
        live_key = "fixtures:live:all"
        live = await cache_get(live_key, "live")
        if live is None:
            try:
                r = await client.get(
                    f"{API_FOOTBALL_BASE}/fixtures",
                    headers={"x-apisports-key": API_FOOTBALL_KEY},
                    params={"live": "all"}
                )
                live = r.json().get("response", [])
                await cache_set(live_key, live, "live")
            except Exception as e:
                logger.warning(f"Live fetch failed: {e}")
                live = []

        premium_live = [f for f in live if is_premium_league(f)]
        for f in premium_live:
            f["_league_name"] = f.get("league", {}).get("name", "")
            f["_status"] = "live"
        all_fixtures.extend(premium_live)
        logger.info(f"Live: {len(live)} total → {len(premium_live)} premium")

        # 2. מתוכננים היום — cache 60 דקות
        if len(all_fixtures) < 5:
            sched_key = f"fixtures:scheduled:{today}"
            scheduled = await cache_get(sched_key, "fixtures")
            if scheduled is None:
                try:
                    r = await client.get(
                        f"{API_FOOTBALL_BASE}/fixtures",
                        headers={"x-apisports-key": API_FOOTBALL_KEY},
                        params={"date": today, "status": "NS"}
                    )
                    scheduled = r.json().get("response", [])
                    await cache_set(sched_key, scheduled, "fixtures")
                except Exception as e:
                    logger.warning(f"Today scheduled failed: {e}")
                    scheduled = []

            premium_sched = [f for f in scheduled if is_premium_league(f)]
            for f in premium_sched:
                f["_league_name"] = f.get("league", {}).get("name", "")
                f["_status"] = "scheduled"
            all_fixtures.extend(premium_sched)
            logger.info(f"Scheduled today: {len(scheduled)} total → {len(premium_sched)} premium")

        # 3. אחרונים — cache 60 דקות
        if len(all_fixtures) < 5:
            from_date   = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
            recent_key  = f"fixtures:recent:{from_date}:{today}"
            finished = await cache_get(recent_key, "fixtures")
            if finished is None:
                try:
                    r = await client.get(
                        f"{API_FOOTBALL_BASE}/fixtures",
                        headers={"x-apisports-key": API_FOOTBALL_KEY},
                        params={"from": from_date, "to": today, "status": "FT"}
                    )
                    finished = r.json().get("response", [])
                    await cache_set(recent_key, finished, "fixtures")
                except Exception as e:
                    logger.warning(f"Recent finished failed: {e}")
                    finished = []

            premium_finished = [f for f in finished if is_premium_league(f)]
            for f in premium_finished:
                f["_league_name"] = f.get("league", {}).get("name", "")
                f["_status"] = "finished"
            premium_finished.sort(key=lambda f: f.get("fixture", {}).get("date", ""), reverse=True)
            all_fixtures.extend(premium_finished[:40])
            logger.info(f"Recent finished: {len(finished)} total → {len(premium_finished)} premium")

    # מיין סופי: חיים → מתוכננים → אחרונים
    status_order = {"live": 0, "scheduled": 1, "finished": 2}
    all_fixtures.sort(key=lambda f: (
        status_order.get(f.get("_status", "finished"), 3),
        f.get("fixture", {}).get("date", "")
    ))
    return all_fixtures


async def fetch_team_form(team_id: int, league_id: int, season: int) -> dict:
    """משוך סטטיסטיקות וצורת קבוצה — מחזיר dict תמיד"""
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                f"{API_FOOTBALL_BASE}/teams/statistics",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"team": team_id, "league": league_id, "season": season}
            )
            resp = r.json().get("response", {})
            # API מחזיר לפעמים list ריקה כשאין נתונים
            if isinstance(resp, list):
                return resp[0] if resp else {}
            return resp if isinstance(resp, dict) else {}
        except Exception:
            return {}


async def fetch_injuries(fixture_id: int) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"{API_FOOTBALL_BASE}/injuries",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"fixture": fixture_id}
            )
            return r.json().get("response", [])
        except Exception:
            return []


async def fetch_weather_for_city(city: str) -> dict:
    """מזג אוויר — עם cache של 30 דקות"""
    if not OPENWEATHER_KEY or OPENWEATHER_KEY == "your_openweather_key_here":
        return _default_weather()

    cache_key = f"weather:{city.lower().strip()}"
    cached = await cache_get(cache_key, "weather")
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.get(
                f"{OPENWEATHER_BASE}/weather",
                params={"q": city, "appid": OPENWEATHER_KEY, "units": "metric"}
            )
            if r.status_code != 200:
                return _default_weather()

            d    = r.json()
            main = d.get("main", {})
            rain = d.get("rain", {}).get("1h", 0)
            result = {
                "temperature_celsius": round(main.get("temp", 20), 1),
                "humidity_percent":    main.get("humidity", 50),
                "precipitation_mm":    rain,
                "wind_speed_kmh":      round(d.get("wind", {}).get("speed", 10) * 3.6, 1),
                "weather_condition":   d.get("weather", [{}])[0].get("main", "Clear"),
                "source":              "live",
            }
            await cache_set(cache_key, result, "weather")
            return result
        except Exception:
            return _default_weather()


def _default_weather() -> dict:
    return {
        "temperature_celsius": 20,
        "humidity_percent":    55,
        "precipitation_mm":    0,
        "wind_speed_kmh":      15,
        "weather_condition":   "Clear",
        "source":              "default",
    }


async def fetch_all_odds() -> list:
    """משוך יחסים (1X2 + Over/Under) — קריאה אחת, cache של 15 דקות"""
    cache_key = "odds:soccer:eu:h2h_totals"   # bumped — now includes totals
    cached = await cache_get(cache_key, "odds")
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.get(
                f"{ODDS_API_BASE}/sports/soccer/odds",
                params={
                    "apiKey":     ODDS_API_KEY,
                    "regions":    "eu",
                    "markets":    "h2h,totals",   # שני השווקים באותה מכסה
                    "oddsFormat": "decimal",
                }
            )
            if r.status_code != 200:
                return []
            data = r.json()
            await cache_set(cache_key, data, "odds")
            return data
        except Exception:
            return []


def find_totals_for_match(all_odds: list, home_team: str, away_team: str, line: float = 2.5) -> dict | None:
    """חפש יחסי Over/Under לקו מסוים (ברירת מחדל 2.5) — מטריצת The Odds API"""
    home_lower = home_team.lower()
    away_lower = away_team.lower()
    for event in all_odds:
        ev_home = event.get("home_team", "").lower()
        ev_away = event.get("away_team", "").lower()
        if not ((home_lower[:6] in ev_home or ev_home[:6] in home_lower) and
                (away_lower[:6] in ev_away or ev_away[:6] in away_lower)):
            continue
        for bm in event.get("bookmakers", []):
            totals = next((m for m in bm.get("markets", []) if m["key"] == "totals"), None)
            if not totals:
                continue
            over  = next((o for o in totals.get("outcomes", [])
                          if o.get("name") == "Over"  and abs(o.get("point", 0) - line) < 0.01), None)
            under = next((o for o in totals.get("outcomes", [])
                          if o.get("name") == "Under" and abs(o.get("point", 0) - line) < 0.01), None)
            if over and under:
                return {
                    "bookmaker": bm.get("title", ""),
                    "line":      line,
                    "over":      over["price"],
                    "under":     under["price"],
                }
    return None


async def fetch_odds_apisports(fixture_id: int) -> dict | None:
    """
    יחסים ישירים לפי fixture ID — מ-API-Sports (אותו מפתח).
    מדויק יותר מחיפוש שם מטושטש ב-The Odds API.
    """
    if not fixture_id or not API_FOOTBALL_KEY:
        return None

    cache_key = f"apisports_odds:{fixture_id}"
    cached = await cache_get(cache_key, "odds")
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                f"{API_FOOTBALL_BASE}/odds",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"fixture": fixture_id},
            )
            resp = r.json().get("response", [])
            if not resp:
                return None

            bookmakers = resp[0].get("bookmakers", [])
            if not bookmakers:
                return None

            bm = next(
                (b for b in bookmakers if b.get("id") == 1 or b.get("name") == "Bet365"),
                bookmakers[0],
            )
            bets = bm.get("bets") or bm.get("markets") or []
            market = next((m for m in bets if m.get("name") == "Match Winner"), None)
            if not market:
                return None

            vals = {v["value"]: float(v["odd"]) for v in market.get("values", []) if v.get("odd")}
            home_odds = vals.get("Home")
            draw_odds = vals.get("Draw", 3.5)
            away_odds = vals.get("Away")
            if not home_odds or not away_odds:
                return None

            result = {
                "bookmaker":         bm.get("name", "API-Sports"),
                "odds_home":         home_odds,
                "odds_draw":         draw_odds,
                "odds_away":         away_odds,
                "implied_prob_home": round(1 / home_odds, 4),
                "implied_prob_draw": round(1 / draw_odds, 4),
                "implied_prob_away": round(1 / away_odds, 4),
                "_source":           "apisports",
            }
            await cache_set(cache_key, result, "odds")
            return result
        except Exception as e:
            logger.debug(f"API-Sports odds {fixture_id}: {e}")
            return None


def find_odds_for_match(all_odds: list, home_team: str, away_team: str) -> dict | None:
    """חפש יחסים למשחק ספציפי — גמיש עם שמות שונים"""
    home_lower = home_team.lower()
    away_lower = away_team.lower()

    for event in all_odds:
        ev_home = event.get("home_team", "").lower()
        ev_away = event.get("away_team", "").lower()

        # חיפוש חלקי — מספיק שחלק מהשם תואם
        if (home_lower[:6] in ev_home or ev_home[:6] in home_lower) and \
           (away_lower[:6] in ev_away or ev_away[:6] in away_lower):

            bms = event.get("bookmakers", [])
            if not bms:
                continue
            # העדפה ל-Pinnacle, אחרת הראשון
            bm = next((b for b in bms if "pinnacle" in b.get("key", "")), bms[0])
            markets = bm.get("markets", [])
            h2h = next((m for m in markets if m["key"] == "h2h"), None)
            if not h2h:
                continue

            outcomes = {o["name"]: o["price"] for o in h2h.get("outcomes", [])}
            home_odds = outcomes.get(event["home_team"], 0)
            away_odds = outcomes.get(event["away_team"], 0)
            draw_odds = outcomes.get("Draw", 3.5)

            if home_odds and away_odds:
                return {
                    "bookmaker":        bm.get("title", ""),
                    "odds_home":        home_odds,
                    "odds_draw":        draw_odds,
                    "odds_away":        away_odds,
                    "implied_prob_home": round(1 / home_odds, 4),
                    "implied_prob_draw": round(1 / draw_odds, 4),
                    "implied_prob_away": round(1 / away_odds, 4),
                }
    return None


def extract_form_score(stats: dict) -> float:
    """חלץ ציון צורה מ-5 משחקים אחרונים"""
    if not isinstance(stats, dict):
        return 0.0
    form_str = stats.get("form", "") or ""
    form_str = form_str[-5:]
    if not form_str:
        return 0.0
    wins   = form_str.count("W")
    losses = form_str.count("L")
    return round((wins - losses) / max(len(form_str), 1), 2)


def extract_xg(stats: dict, direction: str = "for") -> float:
    """
    חלץ xG ממוצע — עם הגנה מלאה מטיפוסים לא צפויים.
    ממוצע 0 או נמוך מאוד = אין נתונים (קבוצה שטרם שיחקה בעונה), לא 0 אמיתי →
    נופלים לברירת מחדל ריאליסטית כדי לא לייצר חיזוי מנוון.
    """
    DEFAULT = 1.2
    if not isinstance(stats, dict):
        return DEFAULT
    try:
        goals = stats.get("goals") or {}
        if not isinstance(goals, dict):
            return DEFAULT
        side = goals.get(direction) or {}
        if not isinstance(side, dict):
            return DEFAULT
        avg = side.get("average") or {}
        if not isinstance(avg, dict):
            return DEFAULT
        val = avg.get("total")
        if val is None:
            return DEFAULT
        xg = float(val)
        # 0 / ערך מזערי = אין נתונים, לא ביצוע אמיתי
        return xg if xg >= 0.2 else DEFAULT
    except (TypeError, ValueError):
        return DEFAULT


def calculate_injury_impact(injuries: list, team_id: int) -> float:
    POSITION_IMPACT = {"Goalkeeper": 0.7, "Defender": 0.55, "Midfielder": 0.4, "Attacker": 0.6, "Forward": 0.6}
    team_injuries = [i for i in injuries if i.get("team", {}).get("id") == team_id]
    total = sum(POSITION_IMPACT.get(i.get("player", {}).get("position", "Midfielder"), 0.35)
                for i in team_injuries)
    return min(round(total, 2), 1.0)


async def fetch_team_stats_cached(team_id: int, league_id: int, season: int) -> dict:
    """סטטיסטיקות קבוצה עם cache 6 שעות — חוסך קריאות API"""
    cache_key = f"team_stats:{team_id}:{league_id}:{season}"
    cached = await cache_get(cache_key, "stats")
    if cached is not None:
        return cached
    result = await fetch_team_form(team_id, league_id, season)
    if result:
        await cache_set(cache_key, result, "stats")
    return result or {}


async def fetch_h2h_cached(home_id: int, away_id: int) -> list:
    """היסטוריית H2H עם cache 6 שעות — 10 משחקים אחרונים"""
    key_a, key_b = min(home_id, away_id), max(home_id, away_id)
    cache_key = f"h2h:{key_a}:{key_b}"
    cached = await cache_get(cache_key, "stats")
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(
                f"{API_FOOTBALL_BASE}/fixtures/headtohead",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"h2h": f"{home_id}-{away_id}", "last": 10}
            )
            data = r.json().get("response", [])
            await cache_set(cache_key, data, "stats")
            return data
        except Exception:
            return []


def calculate_h2h_advantage(h2h_matches: list, home_id: int) -> float:
    """חשב יתרון H2H היסטורי — מחזיר -1 (הפסד) עד +1 (ניצחון)"""
    if not h2h_matches:
        return 0.0
    wins = losses = 0
    for m in h2h_matches[-10:]:
        teams = m.get("teams", {})
        fixture_home_id = teams.get("home", {}).get("id")
        home_winner = teams.get("home", {}).get("winner")
        away_winner = teams.get("away", {}).get("winner")
        if home_winner is None and away_winner is None:
            continue  # תיקו
        is_home = (fixture_home_id == home_id)
        if (home_winner and is_home) or (away_winner and not is_home):
            wins += 1
        else:
            losses += 1
    total = wins + losses
    return 0.0 if total == 0 else round((wins - losses) / total, 2)


# ── xG Calibration Helpers (Option B: Totals-based, Vig-free) ────────────────

def _poisson_under25(lam: float) -> float:
    """P(total goals ≤ 2 | Poisson(λ)) — probability of Under 2.5."""
    e = math.exp(-lam)
    return e * (1 + lam + lam * lam * 0.5)


def _lambda_from_under25(p_under: float) -> float:
    """Binary-search inversion: find λ s.t. P(X ≤ 2 | Poisson(λ)) ≈ p_under."""
    p = max(0.05, min(0.99, p_under))
    lo, hi = 0.3, 9.0
    for _ in range(50):
        mid = (lo + hi) * 0.5
        if _poisson_under25(mid) > p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) * 0.5


def _calibrate_xg_from_market(
    odds: dict,
    totals: dict | None,
    is_neutral: bool,
) -> tuple[float, float, str]:
    """
    Derive (xg_home, xg_away, method) from bookmaker markets.

    Priority:
      1. Over/Under 2.5 total λ split by vig-free 1X2 ratio  → "totals"
      2. Vig-free 1X2 ratio with fixed 2.55 total             → "1x2_vigfree"
      3. Fallback defaults                                      → "default"

    3-way vig removal: S = 1/H + 1/D + 1/A; P_fair = (1/odds) / S
    This removes the bookmaker overround (~3–8%) before deriving strength ratios,
    eliminating the systematic false-positive VALUE that 2-way normalization created.
    """
    try:
        oh = float(odds.get("odds_home") or 0)
        od = float(odds.get("odds_draw") or 0)
        oa = float(odds.get("odds_away") or 0)
        if not (oh > 1.0 and od > 1.0 and oa > 1.0):
            return 1.3, 1.1, "default"

        # 3-way vig removal — draw odds included
        S = 1 / oh + 1 / od + 1 / oa
        p_h = (1 / oh) / S
        p_a = (1 / oa) / S

        h_boost = 1.00 if is_neutral else 1.05
        a_disc  = 1.00 if is_neutral else 0.95

        # Strength ratio from fair 1X2 probs
        R = p_h / max(p_a, 0.01)
        h_split = R / (1 + R)
        a_split = 1.0 - h_split

        # Option B: total λ from Over/Under 2.5 — breaks circularity with 1X2
        if totals:
            ov = float(totals.get("over") or 0)
            un = float(totals.get("under") or 0)
            if ov > 1.0 and un > 1.0:
                S_tot = 1 / ov + 1 / un
                p_under_fair = (1 / un) / S_tot
                xg_total = _lambda_from_under25(p_under_fair)
                return (
                    max(0.60, xg_total * h_split * h_boost),
                    max(0.60, xg_total * a_split * a_disc),
                    "totals",
                )

        # Fallback: fixed 2.55 total, vig-free ratio split
        xg_total = 2.55
        return (
            max(0.60, xg_total * h_split * h_boost),
            max(0.60, xg_total * a_split * a_disc),
            "1x2_vigfree",
        )

    except (TypeError, ValueError, ZeroDivisionError):
        return 1.3, 1.1, "default"


def build_match_analysis_sync(
    fixture: dict,
    all_odds: list,
    weather: dict,
    home_stats: dict | None = None,
    away_stats: dict | None = None,
    h2h_advantage: float = 0.0,
    fixture_odds: dict | None = None,
) -> dict:
    """
    ניתוח מהיר ללא קריאות API נוספות — משתמש בנתוני ה-fixture עצמו.
    כל הנתונים מחושבים מה-fixture + odds שכבר נמשכו.
    """
    fix    = fixture.get("fixture", {})
    teams  = fixture.get("teams", {})
    league = fixture.get("league", {})
    goals  = fixture.get("goals", {})
    score  = fixture.get("score", {})

    home   = teams.get("home", {})
    away   = teams.get("away", {})

    # xG + צורה — מסטטיסטיקות אמיתיות אם זמינות, אחרת הערכה מתוצאות
    home_score = goals.get("home") or 0
    away_score = goals.get("away") or 0

    # מצא יחסים מוקדם — ישמשו לכיול xG כשאין סטטיסטיקות
    odds = find_odds_for_match(all_odds, home.get("name", ""), away.get("name", ""))
    if odds is None and fixture_odds:
        odds = fixture_odds

    # World Cup (league_id=1) is played at a neutral venue — no home advantage
    _is_neutral = league.get("id", 0) == 1

    # Totals lookup — needed for Option-B xG calibration; fetch once, reuse below
    _totals = find_totals_for_match(all_odds, home.get("name", ""), away.get("name", ""))
    _xg_from_market = False   # True when xG is market-derived (no real stats)
    _xg_method      = "real_stats"

    if home_stats:
        xg_home   = extract_xg(home_stats, "for")
        form_home = extract_form_score(home_stats)
    else:
        if home_score:
            xg_home = max(float(home_score) * 0.9 + 0.5, 1.1)
        elif odds:
            xg_home, _, _xg_method = _calibrate_xg_from_market(odds, _totals, _is_neutral)
            _xg_from_market = True
        else:
            xg_home = 1.3
        form_home = 0.4 if home.get("winner") is True else (-0.3 if home.get("winner") is False else 0.0)

    if away_stats:
        xg_away   = extract_xg(away_stats, "for")
        form_away = extract_form_score(away_stats)
    else:
        if away_score:
            xg_away = max(float(away_score) * 0.9 + 0.5, 1.0)
        elif odds:
            _, xg_away, _xg_method = _calibrate_xg_from_market(odds, _totals, _is_neutral)
            _xg_from_market = True
        else:
            xg_away = 1.1
        form_away = 0.4 if away.get("winner") is True else (-0.3 if away.get("winner") is False else 0.0)

    home_injury = 0.0
    away_injury = 0.0
    injuries    = []
    city        = fix.get("venue", {}).get("city", "") or ""

    # If both teams got extract_xg's fallback (1.2) — stats exist but no real xG data
    # (e.g. national teams at WC, new season) — recalibrate via Option B.
    _XG_DEFAULT = 1.2
    if odds and xg_home == _XG_DEFAULT and xg_away == _XG_DEFAULT:
        xg_home, xg_away, _xg_method = _calibrate_xg_from_market(odds, _totals, _is_neutral)
        _xg_from_market = True

    # World Cup (league_id=1) is played at neutral venues — no home advantage
    league_id   = league.get("id", 0)
    venue_type  = "neutral" if league_id == 1 else "home"

    # ── In-play xG decay ─────────────────────────────────────────────────────
    # Scale pre-match xG by fraction of time remaining, then add goals already
    # scored.  Result = total expected goals by the final whistle, which drives
    # the Poisson 1X2 and O/U probability correctly for live matches.
    # Not applied during HT (short="HT") or for scheduled/finished matches.
    _inplay_elapsed = int(fix.get("status", {}).get("elapsed") or 0)
    _inplay_short   = fix.get("status", {}).get("short", "")
    _inplay_active  = _inplay_short in ("1H", "2H", "ET", "LIVE") and _inplay_elapsed > 0

    if _inplay_active:
        _total_min = 120 if _inplay_short == "ET" else 90
        _frac      = max(0.0, (_total_min - _inplay_elapsed) / _total_min)
        xg_home    = max(0.30, xg_home * _frac + home_score)
        xg_away    = max(0.30, xg_away * _frac + away_score)

    # בנה MatchContext
    ctx = MatchContext(
        match_id              = str(fix.get("id", "")),
        home_team             = home.get("name", "Home"),
        away_team             = away.get("name", "Away"),
        xg_home               = xg_home,
        xg_away               = xg_away,
        form_home             = form_home,
        form_away             = form_away,
        h2h_advantage         = h2h_advantage,
        temperature           = weather["temperature_celsius"],
        humidity              = weather["humidity_percent"],
        precipitation_mm      = weather["precipitation_mm"],
        home_injury_impact    = home_injury,
        away_injury_impact    = away_injury,
        crowd_size            = fix.get("venue", {}).get("capacity", 40000) or 40000,
        venue_type            = venue_type,
        tournament_stage      = "group",
        pressure_index        = 0.6,
        rest_days_home        = 7,
        rest_days_away        = 7,
    )

    # הרץ את מנוע החיזוי
    prediction = engine.predict(ctx)

    # ── Dynamic Adjustment ───────────────────────────────────────────────────
    # auto: injury_impact > 0.45 → squad_rotation
    # manual: override ידני דרך POST /api/live/adjust/{fixture_id}
    fid     = fix.get("id")
    _manual = _manual_adjustments.get(fid, {}) if fid else {}
    adj_params = AdjustmentParams(
        home_rotation   = home_injury > 0.45 or bool(_manual.get("home_rotation")),
        away_rotation   = away_injury > 0.45 or bool(_manual.get("away_rotation")),
        home_motivation = float(_manual.get("home_motivation", 0.5)),
        away_motivation = float(_manual.get("away_motivation", 0.5)),
        home_sentiment  = float(_manual.get("home_sentiment",  0.0)),
        away_sentiment  = float(_manual.get("away_sentiment",  0.0)),
    )
    adjusted_probs = adjust_probabilities(prediction["final"], adj_params)
    adj_active = (
        adj_params.home_rotation or adj_params.away_rotation or bool(_manual)
    )
    prediction["adjusted"] = adjusted_probs if adj_active else None

    value_bets  = {}
    if odds:
        for outcome, odd_key in [("home","odds_home"),("draw","odds_draw"),("away","odds_away")]:
            bm_odd = odds.get(odd_key, 0)
            if bm_odd:
                # השתמש בהסתברות מותאמת אם הייתה התאמה, אחרת הסתברות גולמית
                prob = adjusted_probs[outcome] if adj_active else prediction["final"][outcome]
                vb = calculate_value(prob, bm_odd)
                # When xG is market-derived, require a larger edge (8%) to suppress noise
                # from the residual circularity. Still show the bet; just raise the bar.
                _min_edge = 8.0 if _xg_from_market else 0.0
                if vb["is_value_bet"] and vb.get("edge_percent", 0) >= _min_edge:
                    if _xg_from_market:
                        vb["xg_estimated"] = True
                    value_bets[outcome] = vb

    # Over/Under 2.5 — two-layer analysis:
    #   goals_signal : full pre-game Poisson matrix (scipy) with dynamic xG adjustment
    #   ou_edge      : live in-play Poisson PMF on *remaining* expected goals (backward compat)
    goals_signal: GoalsValueSignal | None = None
    ou_edge = None
    totals  = _totals  # already looked up above for xG calibration
    if totals and totals.get("over") and totals.get("under"):
        # Pre-game / full-match: Goals Engine with dynamic xG modifiers
        xg_mods = injury_flags_from_list(
            injuries,
            home_team_id = home.get("id", 0),
            away_team_id = away.get("id", 0),
            weather      = weather,
        )
        goals_signal = calculate_goals_value(
            xg_home    = xg_home,
            xg_away    = xg_away,
            over_odds  = totals["over"],
            under_odds = totals["under"],
            mods       = xg_mods,
        )

        # Live in-play: scale by remaining time + goals already scored
        elapsed_min   = int(fix.get("status", {}).get("elapsed") or 0)
        current_goals = int((goals.get("home") or 0) + (goals.get("away") or 0))
        ou_edge = calculate_under_over_25_edge(
            expected_goals    = round(xg_home + xg_away, 2),
            bookie_under_odds = totals["under"],
            bookie_over_odds  = totals["over"],
            current_minutes   = elapsed_min,
            current_goals     = current_goals,
        )
        bm_name = totals.get("bookmaker", "")
        if ou_edge:
            ou_edge["bookmaker"] = bm_name
        if goals_signal:
            # attach bookmaker name to the signal dict for Telegram formatting
            goals_signal = goals_signal  # frozen dataclass — pass bookmaker via ou_edge

    # קונסנזוס (ללא אנליסטים אנושיים כרגע)
    consensus = calculate_consensus(prediction["final"], [])

    match_date = fix.get("date", "")
    if match_date:
        try:
            dt = datetime.fromisoformat(match_date.replace("Z", "+00:00"))
            match_date_display = dt.astimezone(ISRAEL_TZ).strftime("%d/%m/%Y %H:%M")
        except Exception:
            match_date_display = match_date[:16]
    else:
        match_date_display = ""

    return {
        "fixture_id":    fix.get("id"),
        "home_team":     home.get("name"),
        "away_team":     away.get("name"),
        "home_logo":     home.get("logo"),
        "away_logo":     away.get("logo"),
        "league":        fixture.get("_league_name", league.get("name","")),
        "league_logo":   league.get("logo"),
        "match_date":    match_date_display,
        "city":          city,
        "venue":         fix.get("venue", {}).get("name", ""),
        "referee":       fix.get("referee") or "",
        "prediction":    prediction,
        "odds":          odds,
        "value_bets":    value_bets if value_bets else None,
        "ou_edge":       ou_edge,
        "goals_signal":  goals_signal.to_dict() if goals_signal else None,
        "consensus":     consensus,
        "weather":       weather,
        "xg": {
            "home": round(xg_home, 2),
            "away": round(xg_away, 2),
        },
        # live state — for the LIVE indicator and the in-play tab
        "_status":       fixture.get("_status"),
        "elapsed":       fix.get("status", {}).get("elapsed"),
        "status_short":  fix.get("status", {}).get("short"),
        "score": {
            "home": goals.get("home"),
            "away": goals.get("away"),
        },
        "injuries": {
            "home_impact": home_injury,
            "away_impact": away_injury,
            "count":       len(injuries),
        },
        "form": {
            "home": form_home,
            "away": form_away,
        },
        "data_quality": {
            "xg_source":       "real_stats" if (home_stats and away_stats) else "market",
            "xg_method":       _xg_method,    # "real_stats"|"totals"|"1x2_vigfree"|"default"
            "xg_estimated":    _xg_from_market,
            "inplay_adjusted": _inplay_active,
            "form_source":     "real_stats" if home_stats else "last_result",
            "h2h_used":        h2h_advantage != 0.0,
        },
    }


async def build_match_analysis(fixture: dict, all_odds: list) -> dict:
    """
    ניתוח מלא עם קריאות API — לנתיב המשחק הבודד.
    מושך סטטיסטיקות + H2H + מזג אוויר לפי עיר.
    """
    fix    = fixture.get("fixture", {})
    teams  = fixture.get("teams", {})
    league = fixture.get("league", {})
    home   = teams.get("home", {})
    away   = teams.get("away", {})
    city   = fix.get("venue", {}).get("city", "") or ""

    home_id   = home.get("id", 0)
    away_id   = away.get("id", 0)
    league_id = league.get("id", 0)
    season    = league.get("season", 2024)

    # משוך הכל במקביל: סטטיסטיקות + H2H + מזג אוויר + יחסים ישירים
    home_stats, away_stats, h2h_matches, weather, fixture_odds = await asyncio.gather(
        fetch_team_stats_cached(home_id, league_id, season),
        fetch_team_stats_cached(away_id, league_id, season),
        fetch_h2h_cached(home_id, away_id),
        fetch_weather_for_city(city if city else "London"),
        fetch_odds_apisports(fix.get("id", 0)),
    )

    home_stats  = home_stats  if isinstance(home_stats,  dict) else {}
    away_stats  = away_stats  if isinstance(away_stats,  dict) else {}
    h2h_matches = h2h_matches if isinstance(h2h_matches, list) else []
    h2h_adv     = calculate_h2h_advantage(h2h_matches, home_id)
    fixture_odds = fixture_odds if isinstance(fixture_odds, dict) else None

    return build_match_analysis_sync(fixture, all_odds, weather, home_stats, away_stats, h2h_adv, fixture_odds=fixture_odds)


# ============================================================
# ROUTES
# ============================================================

@router.get("/matches")
async def get_live_matches(background_tasks: BackgroundTasks, days: int = 1, limit: int = 20):
    """
    משחקים אמיתיים עם חיזויים — לימים הקרובים.
    days=1 → היום + מחר
    """
    fixtures = await fetch_todays_fixtures(days_ahead=days)

    if not fixtures:
        return {
            "status":  "no_matches",
            "message": "אין משחקים זמינים כרגע — נסה שוב מאוחר יותר",
            "matches": [],
            "count":   0,
        }

    # הוסף label לסטטוס
    status_label = "live" if any(f.get("_status") == "live" for f in fixtures) \
                   else "scheduled" if any(f.get("_status") == "scheduled" for f in fixtures) \
                   else "recent"

    # הגבל לפי limit parameter
    fixtures = fixtures[:min(limit, 20)]

    # ─── משוך odds מרוכז + נתח כל fixture עם team stats (cached 6h) ──────
    all_odds = await fetch_all_odds()
    if isinstance(all_odds, Exception):
        all_odds = []

    _sem = asyncio.Semaphore(5)  # מגביל ל-5 fixture analyses במקביל

    async def _analyze(f: dict) -> dict | None:
        async with _sem:
            try:
                return await build_match_analysis(f, all_odds)
            except Exception as e:
                logger.error(f"Error analyzing fixture {f.get('fixture', {}).get('id')}: {e}")
                return None

    results = await asyncio.gather(*[_analyze(f) for f in fixtures])
    matches = [r for r in results if r]

    # ── Odds threshold filter ────────────────────────────────────────────────
    # Remove near-certainties: any match where the market's cheapest outcome
    # (the favourite) sits below MIN_MARKET_ODDS has no meaningful value for
    # the user. Matches without odds data are kept (API quota may be exhausted).
    before_odds_filter = len(matches)
    matches = [m for m in matches if passes_odds_threshold(m)]
    logger.info(
        f"Odds filter: {before_odds_filter} → {len(matches)} matches "
        f"(removed {before_odds_filter - len(matches)} below {MIN_MARKET_ODDS}x)"
    )

    # מיין — value bets קודם, אחר כך לפי confidence
    matches.sort(key=lambda m: (
        -1 if (m.get("value_bets") and any(v.get("is_value_bet") for v in m["value_bets"].values())) else 0,
        -(m.get("prediction", {}).get("confidence", 0))
    ))

    # שמור ניבויים ל-DB ברקע (BackgroundTasks — לא נקטע כשהתגובה חוזרת)
    background_tasks.add_task(_save_predictions_bg, matches)

    return {
        "status":       "success",
        "count":        len(matches),
        "display_mode": status_label,
        "odds_source":  "The Odds API",
        "matches":      matches,
    }


async def _save_predictions_bg(matches: list) -> None:
    """שמור ל-DB ברקע — רק משחקים שהמנוע זיהה בהם value bet."""
    for m in matches:
        if not m.get("value_bets"):
            continue
        try:
            await save_match_prediction(m)
        except Exception as e:
            logger.debug(f"BG save failed for {m.get('home_team')}: {e}")


@router.get("/world-cup")
async def get_world_cup_matches(background_tasks: BackgroundTasks, days: int = 7, limit: int = 30):
    """
    🏆 מונדיאל 2026 — כל המשחקים: חיים עכשיו + לוח הימים הקרובים,
    עם חיזויים מלאים. Cache: לוח 6 שעות, לייב 2 דקות.
    """
    today  = datetime.now().strftime("%Y-%m-%d")
    to_day = (datetime.now() + timedelta(days=min(days, 14))).strftime("%Y-%m-%d")

    # ─── 1. לוח המשחקים הקרוב (cache ארוך) ───────────────────────────
    sched_key = f"wc:fixtures:{today}:{to_day}"
    scheduled = await cache_get(sched_key, "fixtures")
    if scheduled is None:
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.get(
                    f"{API_FOOTBALL_BASE}/fixtures",
                    headers={"x-apisports-key": API_FOOTBALL_KEY},
                    params={"league": 1, "season": 2026, "from": today, "to": to_day},
                )
                scheduled = r.json().get("response", [])
                await cache_set(sched_key, scheduled, "fixtures")
            except Exception as e:
                logger.warning(f"WC fixtures fetch failed: {e}")
                scheduled = []

    # ─── 2. חיים עכשיו (אותו cache קצר של הפיד הכללי) ────────────────
    live = await cache_get("fixtures:live:all", "live")
    if live is None:
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.get(
                    f"{API_FOOTBALL_BASE}/fixtures",
                    headers={"x-apisports-key": API_FOOTBALL_KEY},
                    params={"live": "all"},
                )
                live = r.json().get("response", [])
                await cache_set("fixtures:live:all", live, "live")
            except Exception:
                live = []
    live_wc = [f for f in (live or []) if f.get("league", {}).get("id") == 1]

    # ─── מיזוג: לייב גובר על הלוח לפי fixture id ─────────────────────
    LIVE_CODES     = ("1H", "2H", "HT", "ET", "BT", "P", "LIVE")
    FINISHED_CODES = ("FT", "AET", "PEN")
    by_id: dict = {}
    for f in scheduled or []:
        st = f.get("fixture", {}).get("status", {}).get("short", "NS")
        f["_status"] = "live" if st in LIVE_CODES else ("finished" if st in FINISHED_CODES else "scheduled")
        f["_league_name"] = f.get("league", {}).get("name", "")
        by_id[f.get("fixture", {}).get("id")] = f
    for f in live_wc:
        f["_status"] = "live"
        f["_league_name"] = f.get("league", {}).get("name", "")
        by_id[f.get("fixture", {}).get("id")] = f

    fixtures = list(by_id.values())
    if not fixtures:
        return {"status": "no_matches", "message": "אין משחקי מונדיאל בטווח הקרוב",
                "tournament": "FIFA World Cup 2026", "matches": [], "count": 0}

    # חיים → מתוכננים → שנגמרו, לפי תאריך
    order = {"live": 0, "scheduled": 1, "finished": 2}
    fixtures.sort(key=lambda f: (order.get(f.get("_status"), 3), f.get("fixture", {}).get("date", "")))
    fixtures = fixtures[:min(limit, 40)]

    # ─── odds מרוכז + ניתוח מלא עם team stats (cached 6h) ─────────────
    all_odds = await fetch_all_odds()
    if isinstance(all_odds, Exception):
        all_odds = []

    _sem = asyncio.Semaphore(5)

    async def _analyze_wc(f: dict) -> dict | None:
        async with _sem:
            try:
                return await build_match_analysis(f, all_odds)
            except Exception as e:
                logger.error(f"WC analyze error {f.get('fixture', {}).get('id')}: {e}")
                return None

    wc_results = await asyncio.gather(*[_analyze_wc(f) for f in fixtures])
    matches = [r for r in wc_results if r]

    background_tasks.add_task(_save_predictions_bg, matches)

    live_count = sum(1 for m in matches if m.get("_status") == "live")
    return {
        "status":     "success",
        "tournament": "FIFA World Cup 2026",
        "count":      len(matches),
        "live_count": live_count,
        "matches":    matches,
    }


@router.get("/matches/{fixture_id}")
async def get_match_details(fixture_id: int):
    """ניתוח מפורט למשחק ספציפי לפי fixture ID"""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{API_FOOTBALL_BASE}/fixtures",
            headers={"x-apisports-key": API_FOOTBALL_KEY},
            params={"id": fixture_id}
        )
        fixtures = r.json().get("response", [])

    if not fixtures:
        return {"status": "error", "message": "משחק לא נמצא"}

    all_odds = await fetch_all_odds()
    result   = await build_match_analysis(fixtures[0], all_odds)
    return {"status": "success", "match": result}


@router.get("/hot-signals")
async def get_hot_signals():
    """רק המשחקים עם Value Bet מובהק"""
    all_matches = await get_live_matches(days=2)
    hot = [
        m for m in all_matches.get("matches", [])
        if m.get("value_bets") and any(
            v.get("rating") in ["STRONG", "MODERATE"]
            for v in m["value_bets"].values()
        )
    ]
    return {
        "status": "success",
        "count":  len(hot),
        "hot_signals": hot,
    }


@router.get("/cache/stats")
async def get_cache_stats():
    """סטטיסטיקות ה-cache"""
    from app.cache import TTL_MAP, CACHE_MINUTES
    s = await cache_stats()
    return {
        "status": "ok",
        "cache":  s,
        "ttl_settings": {
            "live_matches_min": TTL_MAP["live"] // 60,
            "fixtures_min":     TTL_MAP["fixtures"] // 60,
            "odds_min":         TTL_MAP["odds"] // 60,
            "weather_min":      TTL_MAP["weather"] // 60,
            "configured_ttl_min": CACHE_MINUTES,
        },
    }


@router.delete("/cache/clear")
async def clear_cache():
    """מחק את כל ה-cache"""
    count = await cache_clear_all()
    return {"status": "ok", "cleared_files": count, "message": f"נמחקו {count} entries"}


@router.get("/track-record")
async def get_track_record_api(limit: int = 50):
    """Track Record אמיתי מה-DB — ניבויים + תוצאות + סטטיסטיקות"""
    data = await get_track_record(limit=limit)
    return {"status": "success", **data}


@router.post("/results/{fixture_id}")
async def submit_match_result(fixture_id: int, home_score: int, away_score: int):
    """עדכן תוצאה ידנית למשחק שנגמר"""
    ok = await update_match_result(fixture_id, home_score, away_score)
    if ok:
        return {"status": "success", "message": f"תוצאה נשמרה: {home_score}-{away_score}"}
    return {"status": "error", "message": "משחק לא נמצא ב-DB"}


@router.post("/results/auto-update")
async def auto_update_results():
    """
    מושך תוצאות אמיתיות מ-API-Football עבור כל משחקים שנגמרו ב-DB
    ומעדכן את ה-Track Record אוטומטית.
    """
    from app.db.database import get_db
    pool = await get_db()
    if pool is None:
        return {"status": "error", "message": "DB not connected"}

    # מצא משחקים ב-DB שסטטוסם scheduled ו-match_date כבר עבר
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT api_football_id FROM matches
            WHERE status = 'scheduled'
              AND match_date < NOW() - INTERVAL '2 hours'
              AND api_football_id IS NOT NULL
            LIMIT 20
        """)

    if not rows:
        return {"status": "ok", "updated": 0, "message": "אין משחקים לעדכון"}

    fixture_ids = [r["api_football_id"] for r in rows]
    updated = 0

    async with httpx.AsyncClient(timeout=20) as client:
        for fid in fixture_ids:
            try:
                r = await client.get(
                    f"{API_FOOTBALL_BASE}/fixtures",
                    headers={"x-apisports-key": API_FOOTBALL_KEY},
                    params={"id": fid}
                )
                data = r.json().get("response", [])
                if not data:
                    continue

                fix    = data[0].get("fixture", {})
                goals  = data[0].get("goals", {})
                status = fix.get("status", {}).get("short", "")

                # רק משחקים שנגמרו
                if status not in ("FT", "AET", "PEN"):
                    continue

                home_score = goals.get("home")
                away_score = goals.get("away")

                if home_score is None or away_score is None:
                    continue

                ok = await update_match_result(fid, int(home_score), int(away_score))
                if ok:
                    updated += 1

            except Exception as e:
                logger.error(f"Auto-update failed for fixture {fid}: {e}")
                continue

    return {
        "status":  "success",
        "checked": len(fixture_ids),
        "updated": updated,
        "message": f"עודכנו {updated} תוצאות",
    }


# ── Dynamic Adjuster endpoints ────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel, Field as _Field

class AdjustmentBody(_BaseModel):
    home_motivation: float = _Field(0.5, ge=0.0, le=1.0)
    away_motivation: float = _Field(0.5, ge=0.0, le=1.0)
    home_sentiment:  float = _Field(0.0, ge=-1.0, le=1.0)
    away_sentiment:  float = _Field(0.0, ge=-1.0, le=1.0)
    home_rotation:   bool  = False
    away_rotation:   bool  = False


@router.post("/adjust/{fixture_id}")
async def set_dynamic_adjustment(fixture_id: int, body: AdjustmentBody):
    """
    הזן פרמטרי התאמה דינמית ידניים עבור משחק ספציפי.
    ישפיעו על חישוב Value Bet בריצת ה-scheduler הבאה.

    דוגמה:
        POST /api/live/adjust/1035456
        {"home_motivation": 0.9, "away_rotation": true}
    """
    _manual_adjustments[fixture_id] = body.model_dump()
    logger.info(f"[DynAdj] Manual override set for fixture {fixture_id}: {body}")
    return {
        "status":     "ok",
        "fixture_id": fixture_id,
        "adjustment": body.model_dump(),
        "note":       "יושם בריצת ה-scheduler הבאה (עד 5 דקות)",
    }


@router.delete("/adjust/{fixture_id}")
async def clear_dynamic_adjustment(fixture_id: int):
    """מחק override ידני — המשחק יחזור להתאמה אוטומטית בלבד."""
    removed = _manual_adjustments.pop(fixture_id, None)
    if removed:
        return {"status": "ok", "fixture_id": fixture_id, "removed": removed}
    return {"status": "not_found", "fixture_id": fixture_id}


@router.get("/adjust")
async def list_active_adjustments():
    """רשימת כל ה-overrides הידניים הפעילים כרגע."""
    return {
        "status": "ok",
        "count":  len(_manual_adjustments),
        "adjustments": {
            str(fid): params
            for fid, params in _manual_adjustments.items()
        },
    }
