"""
360SCOUT — Match API Routes
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import sys, os, logging

logger = logging.getLogger(__name__)

sys.path.append(os.path.join(os.path.dirname(__file__), '../../..'))
from app.engine.prediction_model import (
    PredictionEngine, MatchContext, calculate_value, calculate_consensus,
    poisson_match_probabilities,
)

router = APIRouter(prefix="/api/matches", tags=["matches"])
engine = PredictionEngine()

OUTCOME_SIGN = {"home": "1", "draw": "X", "away": "2"}


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class PredictionRequest(BaseModel):
    home_team: str = "Team A"
    away_team: str = "Team B"
    xg_home: float = 1.3
    xg_away: float = 1.1
    form_home: float = 0.0
    form_away: float = 0.0
    h2h_advantage: float = 0.0
    temperature: float = 20.0
    humidity: float = 50.0
    precipitation_mm: float = 0.0
    altitude_meters: int = 0
    home_heat_adaptation: float = 0.5
    away_heat_adaptation: float = 0.5
    referee_cards_per_game: float = 3.5
    referee_home_bias: float = 0.0
    home_injury_impact: float = 0.0
    away_injury_impact: float = 0.0
    crowd_size: int = 40000
    venue_type: str = "neutral"
    tournament_stage: str = "group"
    pressure_index: float = 0.5
    rest_days_home: int = 7
    rest_days_away: int = 7
    travel_km_away: int = 0
    bookmaker_odds_home: Optional[float] = None
    bookmaker_odds_draw: Optional[float] = None
    bookmaker_odds_away: Optional[float] = None
    analyst_predictions: Optional[list] = None


class AnalystPrediction(BaseModel):
    outcome: str
    confidence: int
    win_rate: float = 0.55
    analyst_name: str = "Anonymous"


class CrossCheckRequest(BaseModel):
    match_id: str
    home_team: str
    away_team: str
    base_confidence: float  # 0–100
    prediction: str         # "home" | "draw" | "away"
    fixture_id: Optional[int] = None   # אם סופק — ניגש ל-API-Football
    text_summary: Optional[str] = None # fallback לניתוח טקסט


class AnalystPickInput(BaseModel):
    analyst_name: str
    predict: str    # "1" | "X" | "2"
    confidence: float  # 0.0 – 1.0


class ConsensusMatchRequest(BaseModel):
    match_id: str
    home_team: str
    away_team: str
    our_prediction: str   # "1" | "X" | "2"
    our_probability: float
    analysts: Optional[List[AnalystPickInput]] = None
    fixture_id: Optional[int] = None  # אם סופק — fetch מה-DB


# ============================================================
# ROUTES
# ============================================================

@router.post("/predict")
async def predict_match(req: PredictionRequest):
    """
    Full 360° prediction for a match.
    Send match context → get probabilities, confidence, key factors.
    """
    ctx = MatchContext(
        home_team              = req.home_team,
        away_team              = req.away_team,
        xg_home                = req.xg_home,
        xg_away                = req.xg_away,
        form_home              = req.form_home,
        form_away              = req.form_away,
        h2h_advantage          = req.h2h_advantage,
        temperature            = req.temperature,
        humidity               = req.humidity,
        precipitation_mm       = req.precipitation_mm,
        altitude_meters        = req.altitude_meters,
        home_heat_adaptation   = req.home_heat_adaptation,
        away_heat_adaptation   = req.away_heat_adaptation,
        referee_cards_per_game = req.referee_cards_per_game,
        referee_home_bias      = req.referee_home_bias,
        home_injury_impact     = req.home_injury_impact,
        away_injury_impact     = req.away_injury_impact,
        crowd_size             = req.crowd_size,
        venue_type             = req.venue_type,
        tournament_stage       = req.tournament_stage,
        pressure_index         = req.pressure_index,
        rest_days_home         = req.rest_days_home,
        rest_days_away         = req.rest_days_away,
        travel_km_away         = req.travel_km_away,
    )

    prediction = engine.predict(ctx)

    # Value bets (optional)
    value_bets = {}
    for outcome, odds in [
        ("home", req.bookmaker_odds_home),
        ("draw", req.bookmaker_odds_draw),
        ("away", req.bookmaker_odds_away),
    ]:
        if odds:
            value_bets[outcome] = calculate_value(prediction["final"][outcome], odds)

    # Consensus (optional)
    consensus = None
    if req.analyst_predictions:
        consensus = calculate_consensus(prediction["final"], req.analyst_predictions)

    return {
        "status":     "success",
        "prediction": prediction,
        "value_bets": value_bets if value_bets else None,
        "consensus":  consensus,
    }


@router.post("/value-bet")
async def check_value_bet(
    our_prob: float,
    bookmaker_odds: float,
):
    """Quick value bet check — just send probability and odds."""
    if our_prob <= 0 or our_prob >= 1:
        raise HTTPException(status_code=400, detail="Probability must be between 0 and 1")
    if bookmaker_odds <= 1:
        raise HTTPException(status_code=400, detail="Odds must be > 1.0")

    return calculate_value(our_prob, bookmaker_odds)


@router.post("/consensus")
async def get_consensus(
    algorithm_home: float,
    algorithm_draw: float,
    algorithm_away: float,
    analysts: list[AnalystPrediction],
):
    """Calculate master consensus between algorithm and human analysts."""
    algo_probs = {"home": algorithm_home, "draw": algorithm_draw, "away": algorithm_away}
    analyst_list = [a.model_dump() for a in analysts]

    return calculate_consensus(algo_probs, analyst_list)


@router.post("/cross-check")
async def cross_check_prediction(req: CrossCheckRequest):
    """
    Cross-reference the algorithm's prediction against real-time signals.
    Priority: API-Football injuries → text/simulated fallback.
    """
    alignment_score = 0.0
    insights: list[str] = []
    data_source = "simulated"

    # ── Path 1: real injury data from API-Football ──
    if req.fixture_id:
        try:
            from app.tasks.data_fetcher import fetch_injuries
            injuries = await fetch_injuries(req.fixture_id)
            if injuries:
                data_source = "api-football"
                for side_he, team_name, sign in [
                    ("בית",     req.home_team, -3),
                    ("אורחים",  req.away_team, +2),
                ]:
                    side_list = [
                        i for i in injuries
                        if team_name.lower()[:5] in i.get("team", {}).get("name", "").lower()
                    ]
                    if side_list:
                        names = [i.get("player", {}).get("name", "שחקן") for i in side_list[:2]]
                        alignment_score += sign * min(len(side_list), 3)
                        insights.append(
                            f"פציעות {side_he}: {', '.join(names)} "
                            f"({len(side_list)} שחקנים מחוץ לסגל · מקור: API-Football)."
                        )
        except Exception as exc:
            logger.warning("Injury fetch failed for fixture %s: %s", req.fixture_id, exc)

    # ── Path 2: text / simulated fallback ──
    if not insights:
        text = (req.text_summary or _simulated_feed(req.home_team)).lower()
        data_source = "text-analysis" if req.text_summary else "simulated"

        if any(kw in text for kw in ("injury", "bench", "rotation")):
            alignment_score -= 8
            insights.append("חדשות חמות: דיווחים על רוטציה בסגל או פציעה של שחקן מפתח ברגע האחרון.")
        if any(kw in text for kw in ("must win", "tactical advantage")):
            alignment_score += 7
            insights.append("אנליסטים מסמנים: יתרון טקטי מובהק למאמן ומוטיבציית שיא במשחק הנוכחי.")
        if any(kw in text for kw in ("heavy rain", "storm")):
            alignment_score -= 5
            insights.append("התרעת מזג אוויר: גשם כבד במגרש עשוי לשבש את סגנון המשחק הרגיל ולהגדיל את אלמנט המזל.")

    final_confidence = min(100.0, max(0.0, req.base_confidence + alignment_score))

    if not insights:
        insights.append("הצלבה מלאה: נתוני השטח והרכבי הקבוצות תואמים לחלוטין את מודל הדאטה.")

    return {
        "match_id":              req.match_id,
        "prediction":            req.prediction,
        "original_confidence":   req.base_confidence,
        "adjusted_confidence":   round(final_confidence, 1),
        "alignment_score":       alignment_score,
        "expert_summary_hebrew": " ".join(insights),
        "consensus_reached":     abs(alignment_score) <= 5,
        "data_source":           data_source,
    }


@router.post("/consensus-match")
async def check_consensus_match(req: ConsensusMatchRequest):
    """
    Checks consensus between our system prediction and external analyst picks.
    Uses 1/X/2 format (1=home, X=draw, 2=away).
    Mirrors the JS checkConsensusMatch() function.
    Fetches from DB when fixture_id is provided and no analysts supplied.
    """
    DEMO_ANALYSTS = [
        AnalystPickInput(analyst_name="John (UK Expert)",  predict="1", confidence=0.85),
        AnalystPickInput(analyst_name="Maddison Stats",    predict="1", confidence=0.78),
        AnalystPickInput(analyst_name="BettingInside",     predict="1", confidence=0.82),
    ]
    OUTCOME_MAP = {"home": "1", "draw": "X", "away": "2"}

    analysts_data: list[AnalystPickInput] = req.analysts or []

    # Priority 1: DB analyst predictions (converted from home/draw/away → 1/X/2)
    if not analysts_data and req.fixture_id:
        try:
            from app.db.repository import get_match_analyst_predictions
            db_preds = await get_match_analyst_predictions(req.fixture_id)
            analysts_data = [
                AnalystPickInput(
                    analyst_name=p.get("analyst_name", "אנליסט"),
                    predict=OUTCOME_MAP.get(p.get("outcome", "home"), "1"),
                    confidence=p.get("confidence_level", 5) / 10.0,
                )
                for p in db_preds
            ]
        except Exception as exc:
            logger.warning("Analyst DB fetch failed for fixture %s: %s", req.fixture_id, exc)

    # Priority 2: API-Football predictions endpoint
    apf_data: Optional[dict] = None
    if not analysts_data and req.fixture_id:
        try:
            from app.tasks.data_fetcher import fetch_api_football_predictions
            apf_data = await fetch_api_football_predictions(req.fixture_id)
            if apf_data:
                analysts_data = [
                    AnalystPickInput(analyst_name=f"API-Football ({label})", predict=pick, confidence=round(conf / 100, 3))
                    for label, pick, conf in [
                        ("בית",    "1", apf_data["home_pct"]),
                        ("תיקו",   "X", apf_data["draw_pct"]),
                        ("אורחים", "2", apf_data["away_pct"]),
                    ]
                    if conf > 0
                ]
        except Exception as exc:
            logger.warning("API-Football predictions fetch failed for fixture %s: %s", req.fixture_id, exc)

    # Priority 3: demo fallback — so the UI always shows something useful
    if not analysts_data:
        analysts_data = DEMO_ANALYSTS
        is_demo       = True
        data_source   = "demo"
    else:
        is_demo     = False
        data_source = "api-football" if apf_data else "db"

    # ── evaluateConsensusLock logic ──
    # For API-Football: consensus_rate = the API-Football % for our pick,
    #                   lock = dominantPick matches our pick AND prob ≥ 65%
    # For DB / demo:    consensus_rate = % of analysts agreeing,
    #                   lock = rate ≥ 80% AND prob ≥ 65%
    if data_source == "api-football" and apf_data:
        pct_for_pick = {"1": apf_data["home_pct"], "X": apf_data["draw_pct"], "2": apf_data["away_pct"]}
        rate          = pct_for_pick.get(req.our_prediction, 0.0)
        is_agreement  = apf_data["dominant_pick"] == req.our_prediction
        is_lock       = is_agreement and req.our_probability >= 0.68
        agreeing_str  = f'{int(rate)}% ({apf_data["dominant_pick"]})'
        avg_conf      = rate / 100
        expert_advice = apf_data.get("advice") or ""
    else:
        total        = len(analysts_data)
        agreeing     = [a for a in analysts_data if a.predict == req.our_prediction]
        count        = len(agreeing)
        rate         = (count / total) * 100 if total else 0.0
        avg_conf     = (sum(a.confidence for a in agreeing) / count) if count > 0 else 0.0
        is_lock      = rate >= 80 and req.our_probability >= 0.68
        agreeing_str = f"{count}/{total}"
        expert_advice = ""

    badge = "🔥 נעילת קונסנזוס" if is_lock else ("⚡ בבדיקה" if rate >= 50 else "⚠ פיצול")

    return {
        "match_id":               req.match_id,
        "teams":                  f"{req.home_team} vs {req.away_team}",
        "our_pick":               req.our_prediction,
        "consensus_rate":         round(rate, 1),
        "agreeing_count":         agreeing_str,
        "avg_analysts_confidence": round(avg_conf * 100, 1),
        "is_consensus_lock":      is_lock,
        "display_badge":          badge,
        "expert_advice":          expert_advice,
        "is_demo":                is_demo,
        "data_source":            data_source,
        "analysts": [
            {"name": a.analyst_name, "pick": a.predict, "confidence": round(a.confidence * 100)}
            for a in analysts_data
        ],
    }


def _simulated_feed(home_team: str) -> str:
    """Placeholder — replace with real RapidAPI / RSS fetch."""
    return (
        f"Experts highlight a tactical advantage for {home_team}. "
        "However, late reports indicate heavy rain conditions and potential squad rotation."
    )


@router.get("/demo")
async def demo_prediction():
    """
    Demo prediction with realistic data — no API keys needed.
    Argentina vs France, World Cup Final conditions.
    """
    ctx = MatchContext(
        home_team              = "Argentina",
        away_team              = "France",
        xg_home                = 1.45,
        xg_away                = 1.30,
        form_home              = 0.6,
        form_away              = 0.4,
        h2h_advantage          = 0.2,
        temperature            = 30,
        humidity               = 75,
        precipitation_mm       = 0,
        altitude_meters        = 0,
        home_heat_adaptation   = 0.7,
        away_heat_adaptation   = 0.4,
        referee_cards_per_game = 4.2,
        referee_home_bias      = 0.1,
        home_injury_impact     = 0.0,
        away_injury_impact     = 0.3,   # key defender out
        crowd_size             = 88000,
        venue_type             = "home",
        tournament_stage       = "final",
        pressure_index         = 1.0,
        rest_days_home         = 7,
        rest_days_away         = 5,
        travel_km_away         = 12000,
    )

    prediction = engine.predict(ctx)

    # Simulated bookmaker odds
    value_bets = {
        "home": calculate_value(prediction["final"]["home"], 2.10),
        "draw": calculate_value(prediction["final"]["draw"], 3.40),
        "away": calculate_value(prediction["final"]["away"], 3.20),
    }

    # Simulated analyst predictions
    consensus = calculate_consensus(
        prediction["final"],
        [
            {"outcome": "home", "confidence": 8, "win_rate": 0.65},
            {"outcome": "home", "confidence": 7, "win_rate": 0.58},
            {"outcome": "away", "confidence": 6, "win_rate": 0.60},
            {"outcome": "home", "confidence": 9, "win_rate": 0.70},
            {"outcome": "draw", "confidence": 5, "win_rate": 0.52},
        ]
    )

    return {
        "status":     "demo",
        "match":      "Argentina vs France — World Cup Final",
        "prediction": prediction,
        "value_bets": value_bets,
        "consensus":  consensus,
        "note":       "This is a demo prediction with simulated data.",
    }


@router.get("/{fixture_id}/winning-method")
async def winning_method(fixture_id: int):
    """
    טבלת 'The Winning Method' למשחק אמיתי:
    xG → הסתברות המודל → יחס הוגן → יחס שוק → סטיית ערך.
    משתמש במנוע החי + יחסי שוק אמיתיים (אותו מקור אמת כמו הכרטיסים).
    """
    import httpx
    from app.api.routes.live import (
        API_FOOTBALL_BASE, API_FOOTBALL_KEY,
        build_match_analysis, fetch_all_odds,
    )

    # 1. משוך את ה-fixture
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{API_FOOTBALL_BASE}/fixtures",
                headers={"x-apisports-key": API_FOOTBALL_KEY},
                params={"id": fixture_id},
            )
            fixtures = r.json().get("response", [])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"שגיאה במשיכת המשחק: {e}")

    if not fixtures:
        raise HTTPException(status_code=404, detail="משחק לא נמצא")

    # 2. ניתוח מלא (xG אמיתי + odds + מנוע) — אותו path של עמוד המשחק
    all_odds = await fetch_all_odds()
    match    = await build_match_analysis(fixtures[0], all_odds)

    final = match["prediction"]["final"]
    odds  = match.get("odds") or {}
    vbs   = match.get("value_bets") or {}
    xg    = match.get("xg") or {}

    # 3. בנה את שורות הטבלה
    rows = []
    best_value = None
    for outcome, odds_key in (("home", "odds_home"), ("draw", "odds_draw"), ("away", "odds_away")):
        prob   = final.get(outcome, 0.0)
        fair   = round(1 / prob, 2) if prob > 0 else None
        market = odds.get(odds_key)
        vb     = vbs.get(outcome) or {}
        edge   = vb.get("edge_percent")
        is_value = bool(vb.get("is_value_bet"))
        team = (match["home_team"] if outcome == "home"
                else match["away_team"] if outcome == "away" else "תיקו")

        row = {
            "outcome":      outcome,
            "sign":         OUTCOME_SIGN[outcome],
            "label":        team,
            "model_prob":   round(prob * 100, 1),   # %
            "fair_odds":    fair,
            "market_odds":  market,
            "edge_percent": round(edge, 1) if edge is not None else None,
            "is_value":     is_value,
            "verdict":      "ערך חיובי" if is_value else ("ללא ערך" if market else "אין יחס שוק"),
        }
        rows.append(row)
        if is_value and (best_value is None or (edge or 0) > (best_value.get("edge_percent") or 0)):
            best_value = row

    return {
        "status":     "success",
        "fixture_id": fixture_id,
        "home_team":  match["home_team"],
        "away_team":  match["away_team"],
        "league":     match.get("league"),
        "match_date": match.get("match_date"),
        "method":     "The Winning Method · Poisson goal-matrix",
        "xg": {
            "home":   xg.get("home"),
            "away":   xg.get("away"),
            "source": match.get("data_quality", {}).get("xg_source", "estimated"),
        },
        "confidence":  match["prediction"].get("confidence"),
        "bookmaker":   odds.get("bookmaker"),
        "table":       rows,
        "best_value":  best_value,
        "note":        "יחס הוגן = 1 ÷ הסתברות המודל · ערך חיובי = יחס השוק גבוה מהיחס ההוגן. למטרות מחקר בלבד.",
    }
