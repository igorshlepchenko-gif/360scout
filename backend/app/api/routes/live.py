"""
360SCOUT — Live Matches Route
מושך משחקים אמיתיים מ-API-Football, מריץ עליהם את מנוע החיזוי,
ומחבר יחסי הימורים אמיתיים מ-The Odds API.
"""

import os
import asyncio
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter
import httpx
from dotenv import load_dotenv

load_dotenv()

from app.engine.prediction_model import (
    PredictionEngine, MatchContext, calculate_value, calculate_consensus
)
from app.cache import get as cache_get, set as cache_set, stats as cache_stats
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
        live = cache_get(live_key, "live")
        if live is None:
            try:
                r = await client.get(
                    f"{API_FOOTBALL_BASE}/fixtures",
                    headers={"x-apisports-key": API_FOOTBALL_KEY},
                    params={"live": "all"}
                )
                live = r.json().get("response", [])
                cache_set(live_key, live, "live")
            except Exception as e:
                logger.warning(f"Live fetch failed: {e}")
                live = []

        for f in live:
            f["_league_name"] = f.get("league", {}).get("name", "")
            f["_status"] = "live"
        all_fixtures.extend(live)
        logger.info(f"Live: {len(live)}")

        # 2. מתוכננים היום — cache 60 דקות
        if len(all_fixtures) < 5:
            sched_key = f"fixtures:scheduled:{today}"
            scheduled = cache_get(sched_key, "fixtures")
            if scheduled is None:
                try:
                    r = await client.get(
                        f"{API_FOOTBALL_BASE}/fixtures",
                        headers={"x-apisports-key": API_FOOTBALL_KEY},
                        params={"date": today, "status": "NS"}
                    )
                    scheduled = r.json().get("response", [])
                    cache_set(sched_key, scheduled, "fixtures")
                except Exception as e:
                    logger.warning(f"Today scheduled failed: {e}")
                    scheduled = []

            for f in scheduled:
                f["_league_name"] = f.get("league", {}).get("name", "")
                f["_status"] = "scheduled"
            all_fixtures.extend(scheduled)
            logger.info(f"Scheduled today: {len(scheduled)}")

        # 3. אחרונים — cache 60 דקות
        if len(all_fixtures) < 5:
            from_date   = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
            recent_key  = f"fixtures:recent:{from_date}:{today}"
            finished = cache_get(recent_key, "fixtures")
            if finished is None:
                try:
                    r = await client.get(
                        f"{API_FOOTBALL_BASE}/fixtures",
                        headers={"x-apisports-key": API_FOOTBALL_KEY},
                        params={"from": from_date, "to": today, "status": "FT"}
                    )
                    finished = r.json().get("response", [])
                    cache_set(recent_key, finished, "fixtures")
                except Exception as e:
                    logger.warning(f"Recent finished failed: {e}")
                    finished = []

            for f in finished:
                f["_league_name"] = f.get("league", {}).get("name", "")
                f["_status"] = "finished"
            finished.sort(key=lambda f: f.get("fixture", {}).get("date", ""), reverse=True)
            all_fixtures.extend(finished[:40])
            logger.info(f"Recent finished: {len(finished)}")

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
    cached = cache_get(cache_key, "weather")
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
            cache_set(cache_key, result, "weather")
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
    """משוך יחסים — עם cache של 15 דקות"""
    cache_key = "odds:soccer:eu:h2h"
    cached = cache_get(cache_key, "odds")
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.get(
                f"{ODDS_API_BASE}/sports/soccer/odds",
                params={
                    "apiKey":     ODDS_API_KEY,
                    "regions":    "eu",
                    "markets":    "h2h",
                    "oddsFormat": "decimal",
                }
            )
            if r.status_code != 200:
                return []
            data = r.json()
            cache_set(cache_key, data, "odds")
            return data
        except Exception:
            return []


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
    """חלץ xG ממוצע — עם הגנה מלאה מטיפוסים לא צפויים"""
    if not isinstance(stats, dict):
        return 1.2
    try:
        goals = stats.get("goals") or {}
        if not isinstance(goals, dict):
            return 1.2
        side = goals.get(direction) or {}
        if not isinstance(side, dict):
            return 1.2
        avg = side.get("average") or {}
        if not isinstance(avg, dict):
            return 1.2
        val = avg.get("total")
        return float(val) if val else 1.2
    except (TypeError, ValueError):
        return 1.2


def calculate_injury_impact(injuries: list, team_id: int) -> float:
    POSITION_IMPACT = {"Goalkeeper": 0.7, "Defender": 0.55, "Midfielder": 0.4, "Attacker": 0.6, "Forward": 0.6}
    team_injuries = [i for i in injuries if i.get("team", {}).get("id") == team_id]
    total = sum(POSITION_IMPACT.get(i.get("player", {}).get("position", "Midfielder"), 0.35)
                for i in team_injuries)
    return min(round(total, 2), 1.0)


async def fetch_team_stats_cached(team_id: int, league_id: int, season: int) -> dict:
    """סטטיסטיקות קבוצה עם cache 6 שעות — חוסך קריאות API"""
    cache_key = f"team_stats:{team_id}:{league_id}:{season}"
    cached = cache_get(cache_key, "stats")
    if cached is not None:
        return cached
    result = await fetch_team_form(team_id, league_id, season)
    if result:
        cache_set(cache_key, result, "stats")
    return result or {}


async def fetch_h2h_cached(home_id: int, away_id: int) -> list:
    """היסטוריית H2H עם cache 6 שעות — 10 משחקים אחרונים"""
    key_a, key_b = min(home_id, away_id), max(home_id, away_id)
    cache_key = f"h2h:{key_a}:{key_b}"
    cached = cache_get(cache_key, "stats")
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
            cache_set(cache_key, data, "stats")
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


def build_match_analysis_sync(
    fixture: dict,
    all_odds: list,
    weather: dict,
    home_stats: dict | None = None,
    away_stats: dict | None = None,
    h2h_advantage: float = 0.0,
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

    if home_stats:
        xg_home   = extract_xg(home_stats, "for")
        form_home = extract_form_score(home_stats)
    else:
        xg_home   = max(float(home_score) * 0.9 + 0.5, 1.1) if home_score else 1.3
        form_home = 0.4 if home.get("winner") is True else (-0.3 if home.get("winner") is False else 0.0)

    if away_stats:
        xg_away   = extract_xg(away_stats, "for")
        form_away = extract_form_score(away_stats)
    else:
        xg_away   = max(float(away_score) * 0.9 + 0.5, 1.0) if away_score else 1.1
        form_away = 0.4 if away.get("winner") is True else (-0.3 if away.get("winner") is False else 0.0)

    home_injury = 0.0
    away_injury = 0.0
    injuries    = []
    city        = fix.get("venue", {}).get("city", "") or ""

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
        venue_type            = "home",
        tournament_stage      = "group",
        pressure_index        = 0.6,
        rest_days_home        = 7,
        rest_days_away        = 7,
    )

    # הרץ את מנוע החיזוי
    prediction = engine.predict(ctx)

    # חפש יחסים
    odds        = find_odds_for_match(all_odds, home.get("name",""), away.get("name",""))
    value_bets  = {}
    if odds:
        for outcome, odd_key in [("home","odds_home"),("draw","odds_draw"),("away","odds_away")]:
            bm_odd = odds.get(odd_key, 0)
            if bm_odd:
                vb = calculate_value(prediction["final"][outcome], bm_odd)
                if vb["value"] != 0:
                    value_bets[outcome] = vb

    # קונסנזוס (ללא אנליסטים אנושיים כרגע)
    consensus = calculate_consensus(prediction["final"], [])

    match_date = fix.get("date", "")
    if match_date:
        try:
            dt = datetime.fromisoformat(match_date.replace("Z", "+00:00"))
            match_date_display = dt.strftime("%d/%m/%Y %H:%M")
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
        "prediction":    prediction,
        "odds":          odds,
        "value_bets":    value_bets if value_bets else None,
        "consensus":     consensus,
        "weather":       weather,
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
            "xg_source":   "real_stats" if home_stats else "estimated",
            "form_source": "real_stats" if home_stats else "last_result",
            "h2h_used":    h2h_advantage != 0.0,
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

    # משוך הכל במקביל: סטטיסטיקות + H2H + מזג אוויר לפי עיר
    home_stats, away_stats, h2h_matches, weather = await asyncio.gather(
        fetch_team_stats_cached(home_id, league_id, season),
        fetch_team_stats_cached(away_id, league_id, season),
        fetch_h2h_cached(home_id, away_id),
        fetch_weather_for_city(city if city else "London"),
    )

    home_stats  = home_stats  if isinstance(home_stats,  dict) else {}
    away_stats  = away_stats  if isinstance(away_stats,  dict) else {}
    h2h_matches = h2h_matches if isinstance(h2h_matches, list) else []
    h2h_adv     = calculate_h2h_advantage(h2h_matches, home_id)

    return build_match_analysis_sync(fixture, all_odds, weather, home_stats, away_stats, h2h_adv)


# ============================================================
# ROUTES
# ============================================================

@router.get("/matches")
async def get_live_matches(days: int = 1, limit: int = 20):
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

    # ─── ערים ייחודיות לפי venue ──────────────────────────────────────
    cities = list(dict.fromkeys(
        f.get("fixture", {}).get("venue", {}).get("city") or "London"
        for f in fixtures
    ))

    # ─── משוך odds + weather בלבד (ללא team stats — חוסך קריאות API) ──
    # team stats נמשכים רק ב-/matches/{id} (detail view) עם cache
    gather_tasks = (
        [fetch_all_odds()] +
        [fetch_weather_for_city(city) for city in cities]
    )
    gather_results = await asyncio.gather(*gather_tasks, return_exceptions=True)

    all_odds = gather_results[0] if not isinstance(gather_results[0], Exception) else []
    city_weather: dict[str, dict] = {}
    for i, city in enumerate(cities):
        w = gather_results[1 + i]
        city_weather[city] = w if isinstance(w, dict) else _default_weather()

    # ─── נתח כל משחק (xG/form מוערכים — מהיר, ללא API נוסף) ──────────
    matches = []
    for f in fixtures:
        try:
            fix_     = f.get("fixture", {})
            city_key = fix_.get("venue", {}).get("city") or "London"
            weather  = city_weather.get(city_key, _default_weather())

            result = build_match_analysis_sync(f, all_odds, weather)
            if result:
                matches.append(result)
        except Exception as e:
            logger.error(f"Error analyzing fixture {f.get('fixture', {}).get('id')}: {e}")
            continue

    # מיין — value bets קודם, אחר כך לפי confidence
    matches.sort(key=lambda m: (
        -1 if (m.get("value_bets") and any(v.get("is_value_bet") for v in m["value_bets"].values())) else 0,
        -(m.get("prediction", {}).get("confidence", 0))
    ))

    # שמור ניבויים ל-DB ברקע (לא חוסם את התגובה)
    asyncio.create_task(_save_predictions_bg(matches))

    return {
        "status":       "success",
        "count":        len(matches),
        "display_mode": status_label,
        "odds_source":  "The Odds API",
        "matches":      matches,
    }


async def _save_predictions_bg(matches: list) -> None:
    """שמור ניבויים ל-DB ברקע — שגיאות לא גורמות לקריסה"""
    for m in matches:
        try:
            await save_match_prediction(m)
        except Exception as e:
            logger.debug(f"BG save failed for {m.get('home_team')}: {e}")


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
    """סטטיסטיקות ה-cache — כמה קריאות API נחסכו"""
    from app.cache import stats as cache_stats, CACHE_MINUTES, TTL_MAP
    s = cache_stats()
    return {
        "status": "ok",
        "cache":  s,
        "ttl_settings": {
            "live_matches_min":     TTL_MAP["live"] // 60,
            "fixtures_min":         TTL_MAP["fixtures"] // 60,
            "odds_min":             TTL_MAP["odds"] // 60,
            "weather_min":          TTL_MAP["weather"] // 60,
            "configured_ttl_min":   CACHE_MINUTES,
        },
        "tip": "כל קריאה שנשמרת ב-cache חוסכת 1 מתוך 100 הקריאות היומיות שלך"
    }


@router.delete("/cache/clear")
async def clear_cache():
    """מחק את כל ה-cache — שימושי לאחר עדכון API keys"""
    from app.cache import clear_all
    count = clear_all()
    return {"status": "ok", "cleared_files": count, "message": f"נמחקו {count} קבצי cache"}


@router.get("/track-record")
async def get_track_record_api(limit: int = 50):
    """Track Record אמיתי מה-DB — ניבויים + תוצאות + סטטיסטיקות"""
    data = await get_track_record(limit=limit)
    return {"status": "success", **data}


@router.post("/results/{fixture_id}")
async def submit_match_result(fixture_id: int, home_score: int, away_score: int):
    """
    עדכן תוצאה אמיתית למשחק שנגמר.
    מחשב אוטומטית האם הניבוי היה נכון ומעדכן את ה-Track Record.
    """
    ok = await update_match_result(fixture_id, home_score, away_score)
    if ok:
        return {"status": "success", "message": f"תוצאה נשמרה: {home_score}-{away_score}"}
    return {"status": "error", "message": "משחק לא נמצא ב-DB — ייתכן שלא נוצר ניבוי מראש"}
