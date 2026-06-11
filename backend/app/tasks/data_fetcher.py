"""
360SCOUT — Automated Data Fetcher
Runs daily via Celery Beat to pull fixtures, weather, odds, and trigger predictions.
"""

import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

API_FOOTBALL_KEY = os.getenv("API_FOOTBALL_KEY", "")
OPENWEATHER_KEY  = os.getenv("OPENWEATHER_KEY", "")
ODDS_API_KEY     = os.getenv("ODDS_API_KEY", "")
TELEGRAM_TOKEN   = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHANNEL = os.getenv("TELEGRAM_CHANNEL_ID", "")

# Leagues to track (API-Football IDs)
LEAGUES_TO_TRACK = [
    {"id": 1,   "name": "FIFA World Cup 2026",     "season": 2026},
    {"id": 2,   "name": "UEFA Champions League",   "season": 2025},
    {"id": 3,   "name": "UEFA Europa League",      "season": 2025},
    {"id": 39,  "name": "Premier League",          "season": 2025},
    {"id": 140, "name": "La Liga",                 "season": 2025},
    {"id": 135, "name": "Serie A",                 "season": 2025},
    {"id": 78,  "name": "Bundesliga",              "season": 2025},
    {"id": 61,  "name": "Ligue 1",                 "season": 2025},
    {"id": 71,  "name": "Brazilian League",        "season": 2025},
    {"id": 253, "name": "MLS",                     "season": 2025},
]

API_FOOTBALL_BASE = "https://v3.football.api-sports.io"
OPENWEATHER_BASE  = "https://api.openweathermap.org/data/2.5"
ODDS_API_BASE     = "https://api.the-odds-api.com/v4"


# ============================================================
# FIXTURES FETCHER
# ============================================================

async def fetch_fixtures_for_league(league_id: int, season: int) -> list:
    """Fetch upcoming fixtures for next 7 days"""
    from_date = datetime.now().strftime("%Y-%m-%d")
    to_date   = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{API_FOOTBALL_BASE}/fixtures",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={
                    "league":  league_id,
                    "from":    from_date,
                    "to":      to_date,
                    "season":  season,
                    "status":  "NS",  # Not Started
                }
            )
            resp.raise_for_status()
            data = resp.json()
            fixtures = data.get("response", [])
            logger.info(f"League {league_id}: {len(fixtures)} fixtures found")
            return fixtures
        except Exception as e:
            logger.error(f"Failed to fetch fixtures for league {league_id}: {e}")
            return []


async def fetch_team_stats(team_id: int, league_id: int, season: int) -> dict:
    """Fetch xG, form, possession for a team"""
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{API_FOOTBALL_BASE}/teams/statistics",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"team": team_id, "league": league_id, "season": season}
            )
            resp.raise_for_status()
            return resp.json().get("response", {})
        except Exception as e:
            logger.error(f"Failed to fetch team stats {team_id}: {e}")
            return {}


async def fetch_injuries(fixture_id: int) -> list:
    """Fetch injury reports for a fixture"""
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{API_FOOTBALL_BASE}/injuries",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"fixture": fixture_id}
            )
            resp.raise_for_status()
            return resp.json().get("response", [])
        except Exception as e:
            logger.error(f"Failed to fetch injuries for fixture {fixture_id}: {e}")
            return []


async def fetch_api_football_predictions(fixture_id: int) -> Optional[dict]:
    """
    Fetch API-Football predictions for a fixture.
    Returns dict: advice, winner_name, home_pct, draw_pct, away_pct, dominant_pick
    """
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{API_FOOTBALL_BASE}/predictions",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"fixture": fixture_id},
            )
            resp.raise_for_status()
            items = resp.json().get("response", [])
            if not items:
                return None
            data    = items[0]
            pct     = data.get("predictions", {}).get("percent", {})
            home_pct = float(str(pct.get("home", "0")).replace("%", "") or 0)
            draw_pct = float(str(pct.get("draw", "0")).replace("%", "") or 0)
            away_pct = float(str(pct.get("away", "0")).replace("%", "") or 0)
            # Only lock to 1/2 when clearly dominant (>55%), otherwise "X" = unclear
            dominant = "X"
            if home_pct > 55:
                dominant = "1"
            elif away_pct > 55:
                dominant = "2"
            winner   = (data.get("predictions", {}).get("winner") or {}).get("name", "")
            advice   = data.get("predictions", {}).get("advice", "")
            return {
                "advice":        advice,
                "winner_name":   winner,
                "home_pct":      home_pct,
                "draw_pct":      draw_pct,
                "away_pct":      away_pct,
                "dominant_pick": dominant,
            }
        except Exception as e:
            logger.error(f"Failed to fetch predictions for fixture {fixture_id}: {e}")
            return None


async def fetch_h2h(team_a: int, team_b: int) -> list:
    """Fetch head-to-head history"""
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{API_FOOTBALL_BASE}/fixtures/headtohead",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"h2h": f"{team_a}-{team_b}", "last": 10}
            )
            resp.raise_for_status()
            return resp.json().get("response", [])
        except Exception as e:
            logger.error(f"Failed to fetch H2H {team_a} vs {team_b}: {e}")
            return []


# ============================================================
# WEATHER FETCHER
# ============================================================

async def fetch_weather(city: str, match_date: str) -> dict:
    """Fetch weather forecast for match city"""
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{OPENWEATHER_BASE}/forecast",
                params={
                    "q":     city,
                    "appid": OPENWEATHER_KEY,
                    "units": "metric",
                    "cnt":   8,  # 24 hours ahead
                }
            )
            resp.raise_for_status()
            data = resp.json()

            # Get closest forecast to match time
            forecasts = data.get("list", [])
            if not forecasts:
                return _default_weather()

            forecast = forecasts[0]
            main     = forecast.get("main", {})
            weather  = forecast.get("weather", [{}])[0]
            rain     = forecast.get("rain", {}).get("3h", 0)
            wind     = forecast.get("wind", {}).get("speed", 0)

            return {
                "temperature_celsius": main.get("temp", 20),
                "humidity_percent":    main.get("humidity", 50),
                "precipitation_mm":    rain,
                "wind_speed_kmh":      round(wind * 3.6, 1),
                "weather_condition":   weather.get("main", "Clear").lower(),
                "description":         weather.get("description", ""),
            }
        except Exception as e:
            logger.error(f"Failed to fetch weather for {city}: {e}")
            return _default_weather()


def _default_weather() -> dict:
    return {
        "temperature_celsius": 20,
        "humidity_percent":    50,
        "precipitation_mm":    0,
        "wind_speed_kmh":      15,
        "weather_condition":   "clear",
        "description":         "No data",
    }


# ============================================================
# ODDS FETCHER
# ============================================================

async def fetch_odds(home_team: str, away_team: str) -> Optional[dict]:
    """Fetch live bookmaker odds"""
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{ODDS_API_BASE}/sports/soccer/odds",
                params={
                    "apiKey":  ODDS_API_KEY,
                    "regions": "eu",
                    "markets": "h2h",
                    "oddsFormat": "decimal",
                }
            )
            resp.raise_for_status()
            events = resp.json()

            # Find matching event
            for event in events:
                if (home_team.lower() in event.get("home_team", "").lower() or
                        away_team.lower() in event.get("away_team", "").lower()):

                    bookmakers = event.get("bookmakers", [])
                    if not bookmakers:
                        continue

                    # Use first available bookmaker (prefer Pinnacle)
                    bm = next(
                        (b for b in bookmakers if "pinnacle" in b["key"]),
                        bookmakers[0]
                    )
                    markets = bm.get("markets", [])
                    h2h = next((m for m in markets if m["key"] == "h2h"), None)

                    if not h2h:
                        continue

                    outcomes = {o["name"]: o["price"] for o in h2h.get("outcomes", [])}
                    home_odds = outcomes.get(event["home_team"], 0)
                    away_odds = outcomes.get(event["away_team"], 0)
                    draw_odds = outcomes.get("Draw", 0)

                    if home_odds and away_odds:
                        return {
                            "bookmaker":   bm["title"],
                            "odds_home":   home_odds,
                            "odds_draw":   draw_odds or 3.5,
                            "odds_away":   away_odds,
                            "implied_prob_home": round(1 / home_odds, 4),
                            "implied_prob_draw": round(1 / (draw_odds or 3.5), 4),
                            "implied_prob_away": round(1 / away_odds, 4),
                        }
        except Exception as e:
            logger.error(f"Failed to fetch odds: {e}")

    return None


# ============================================================
# INJURY IMPACT CALCULATOR
# ============================================================

POSITION_IMPACT = {
    "GK":  0.70,  # Goalkeeper out = big deal
    "CB":  0.55,
    "LB":  0.30,
    "RB":  0.30,
    "DM":  0.50,
    "CM":  0.40,
    "AM":  0.45,
    "LW":  0.40,
    "RW":  0.40,
    "ST":  0.60,
}

def calculate_injury_impact(injuries: list, team_id: int) -> float:
    """
    Returns 0.0–1.0 representing how badly the team is affected.
    Multiple key injuries compound.
    """
    team_injuries = [i for i in injuries if i.get("team", {}).get("id") == team_id]
    if not team_injuries:
        return 0.0

    total_impact = 0.0
    for injury in team_injuries:
        position = injury.get("player", {}).get("position", "CM")
        # Map API position to our position codes
        pos_code = _map_position(position)
        impact   = POSITION_IMPACT.get(pos_code, 0.35)
        total_impact += impact

    # Cap at 1.0 (can't be worse than "everything is broken")
    return min(total_impact, 1.0)


def _map_position(api_position: str) -> str:
    mapping = {
        "Goalkeeper":    "GK",
        "Defender":      "CB",
        "Midfielder":    "CM",
        "Attacker":      "ST",
        "Forward":       "ST",
    }
    return mapping.get(api_position, "CM")


# ============================================================
# TELEGRAM ALERTS
# ============================================================

async def send_telegram_alert(message: str) -> bool:
    """Send a message to the Telegram channel"""
    if not TELEGRAM_TOKEN or not TELEGRAM_CHANNEL:
        logger.warning("Telegram not configured")
        return False

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                json={
                    "chat_id":    TELEGRAM_CHANNEL,
                    "text":       message,
                    "parse_mode": "Markdown",
                }
            )
            resp.raise_for_status()
            return True
        except Exception as e:
            logger.error(f"Telegram send failed: {e}")
            return False


async def send_value_bet_alert(match: dict, outcome: str, value_result: dict) -> None:
    stars  = "⭐" * (3 if value_result["rating"] == "STRONG" else 2 if value_result["rating"] == "MODERATE" else 1)
    emoji  = {"home": "🏠", "away": "✈️", "draw": "🤝"}.get(outcome, "⚽")

    home_team    = match['home_team']
    away_team    = match['away_team']
    # Show the recommended team name explicitly — avoids any BiDi rendering ambiguity
    outcome_team = home_team if outcome == "home" else (away_team if outcome == "away" else "Draw")

    message = f"""
🔥 *VALUE BET DETECTED* {stars}

🏠 Home: {home_team}
✈️ Away: {away_team}
📅 {match.get('match_date', 'TBD')}
🏆 {match.get('league', '')}

{emoji} *Outcome: {outcome_team}*
━━━━━━━━━━━━━━━━━━━━
📊 Our Model:       `{value_result['our_prob']:.1%}`
📉 Market Implied:  `{value_result['implied_prob']:.1%}`
💰 Bookmaker Odds:  `{value_result['bookmaker_odds']}`
📈 Edge:            *+{value_result['edge_percent']:.1f}%*
⭐ Rating:          *{value_result['rating']}*
━━━━━━━━━━━━━━━━━━━━
🎯 Confidence: {match.get('confidence', 'N/A')}%

_360SCOUT Predictive Engine_
"""
    await send_telegram_alert(message)


# ============================================================
# MAIN PIPELINE RUNNER (called by Celery or manually)
# ============================================================

async def run_daily_pipeline() -> dict:
    """
    Full daily pipeline:
    1. Fetch all fixtures for tracked leagues
    2. Fetch weather, injuries, odds for each
    3. Build MatchContext
    4. Run prediction engine
    5. Detect value bets & send alerts
    """
    from app.engine.prediction_model import PredictionEngine, MatchContext, calculate_value

    engine  = PredictionEngine()
    results = []

    for league in LEAGUES_TO_TRACK:
        fixtures = await fetch_fixtures_for_league(league["id"], league["season"])

        for fixture in fixtures:
            try:
                fix  = fixture.get("fixture", {})
                home = fixture.get("teams", {}).get("home", {})
                away = fixture.get("teams", {}).get("away", {})
                city = fixture.get("fixture", {}).get("venue", {}).get("city", "")

                logger.info(f"Processing: {home['name']} vs {away['name']}")

                # Fetch parallel data
                weather_task  = fetch_weather(city, fix.get("date", ""))
                injuries_task = fetch_injuries(fix.get("id", 0))
                odds_task     = fetch_odds(home["name"], away["name"])
                home_stats_task = fetch_team_stats(home["id"], league["id"], league["season"])
                away_stats_task = fetch_team_stats(away["id"], league["id"], league["season"])

                weather, injuries, odds, home_stats, away_stats = await asyncio.gather(
                    weather_task, injuries_task, odds_task,
                    home_stats_task, away_stats_task
                )

                # Compute injury impacts
                home_injury = calculate_injury_impact(injuries, home["id"])
                away_injury = calculate_injury_impact(injuries, away["id"])

                # Extract form from API stats
                def get_form_score(stats: dict) -> float:
                    form_str = stats.get("form", "")[-5:]  # last 5 games
                    if not form_str:
                        return 0.0
                    wins   = form_str.count("W")
                    losses = form_str.count("L")
                    return (wins - losses) / max(len(form_str), 1)

                # Build context
                ctx = MatchContext(
                    match_id   = str(fix.get("id", "")),
                    home_team  = home.get("name", "Home"),
                    away_team  = away.get("name", "Away"),
                    xg_home    = float(home_stats.get("goals", {}).get("for", {}).get("average", {}).get("total", 1.3) or 1.3),
                    xg_away    = float(away_stats.get("goals", {}).get("for", {}).get("average", {}).get("total", 1.1) or 1.1),
                    form_home  = get_form_score(home_stats),
                    form_away  = get_form_score(away_stats),
                    temperature       = weather["temperature_celsius"],
                    humidity          = weather["humidity_percent"],
                    precipitation_mm  = weather["precipitation_mm"],
                    home_injury_impact = home_injury,
                    away_injury_impact = away_injury,
                    venue_type = "neutral",
                )

                # Run prediction
                prediction = engine.predict(ctx)

                # Check value bets
                if odds:
                    match_meta = {
                        "home_team":  home["name"],
                        "away_team":  away["name"],
                        "match_date": fix.get("date", ""),
                        "league":     league["name"],
                        "confidence": prediction["confidence"],
                        "monte_carlo": prediction["monte_carlo"],
                    }

                    for outcome, odd_key in [("home", "odds_home"), ("away", "odds_away"), ("draw", "odds_draw")]:
                        bm_odds = odds.get(odd_key, 0)
                        if bm_odds:
                            vb = calculate_value(prediction["final"][outcome], bm_odds)
                            if vb["is_value_bet"]:
                                logger.info(f"VALUE BET: {outcome} @ {bm_odds} (edge: {vb['edge_percent']:.1f}%)")
                                await send_value_bet_alert(match_meta, outcome, vb)

                results.append({
                    "fixture_id": fix.get("id"),
                    "match":      f"{home['name']} vs {away['name']}",
                    "prediction": prediction,
                    "odds":       odds,
                    "weather":    weather,
                })

            except Exception as e:
                logger.error(f"Error processing fixture: {e}", exc_info=True)
                continue

    logger.info(f"Pipeline complete. Processed {len(results)} matches.")
    return {"processed": len(results), "matches": results}


if __name__ == "__main__":
    # Run pipeline manually for testing
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_daily_pipeline())
