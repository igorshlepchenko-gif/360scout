"""
360SCOUT — Match API Routes
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import sys, os

sys.path.append(os.path.join(os.path.dirname(__file__), '../../..'))
from app.engine.prediction_model import (
    PredictionEngine, MatchContext, calculate_value, calculate_consensus
)

router = APIRouter(prefix="/api/matches", tags=["matches"])
engine = PredictionEngine()


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
