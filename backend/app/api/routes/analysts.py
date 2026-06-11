"""
360SCOUT — Analysts Route
ניהול אנליסטים + הזנת ניבויים ידניים + לוח תוצאות
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from app.db.repository import (
    create_analyst,
    list_analysts,
    submit_analyst_prediction,
    get_match_analyst_predictions,
    get_analyst_predictions_history,
    get_consensus_locks,
)

router = APIRouter(prefix="/api/analysts", tags=["analysts"])


class CreateAnalystRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    expertise_league: str = ""


class SubmitPredictionRequest(BaseModel):
    fixture_id: int
    analyst_id: str
    outcome: str          # "home" | "draw" | "away"
    confidence: int = Field(..., ge=1, le=10)
    reasoning: str = ""


@router.get("")
async def get_analysts():
    """רשימת כל האנליסטים עם ביצועים"""
    analysts = await list_analysts()
    return {
        "status":   "success",
        "count":    len(analysts),
        "analysts": [
            {
                **a,
                "id":           str(a["id"]),
                "created_at":   a["created_at"].isoformat() if a.get("created_at") else None,
                "accuracy_pct": round(a["win_rate"] * 100, 1),
            }
            for a in analysts
        ],
    }


@router.post("")
async def add_analyst(req: CreateAnalystRequest):
    """הוסף אנליסט חדש"""
    uid = await create_analyst(req.name, req.expertise_league)
    if not uid:
        raise HTTPException(status_code=500, detail="שגיאה ביצירת אנליסט")
    return {"status": "success", "analyst_id": uid, "name": req.name}


@router.post("/predict")
async def submit_prediction(req: SubmitPredictionRequest):
    """הזן ניבוי של אנליסט למשחק"""
    if req.outcome not in ("home", "draw", "away"):
        raise HTTPException(status_code=400, detail="outcome חייב להיות home / draw / away")

    ok = await submit_analyst_prediction(
        req.fixture_id, req.analyst_id, req.outcome, req.confidence, req.reasoning
    )
    if not ok:
        raise HTTPException(
            status_code=404,
            detail="משחק לא נמצא ב-DB — ייתכן שהניבוי האלגוריתמי טרם נוצר עבורו"
        )
    return {
        "status":  "success",
        "message": f"ניבוי נשמר: {req.outcome} (ביטחון {req.confidence}/10)",
    }


@router.get("/match/{fixture_id}")
async def get_predictions_for_match(fixture_id: int):
    """כל ניבויי האנליסטים למשחק ספציפי"""
    preds = await get_match_analyst_predictions(fixture_id)
    return {
        "status":      "success",
        "fixture_id":  fixture_id,
        "count":       len(preds),
        "predictions": [
            {
                **p,
                "analyst_id":   str(p["analyst_id"]),
                "submitted_at": p["submitted_at"].isoformat() if p.get("submitted_at") else None,
            }
            for p in preds
        ],
    }


@router.get("/consensus-locks")
async def consensus_locks(limit: int = 10):
    """נעילות קונסנזוס פעילות — אנליסטים שמסכימים עם האלגוריתם על משחקים שטרם הוכרעו"""
    locks = await get_consensus_locks(limit)
    return {"status": "success", "count": len(locks), "locks": locks}


@router.get("/{analyst_id}/history")
async def get_analyst_history(analyst_id: str, limit: int = 20):
    """היסטוריית ניבויים של אנליסט ספציפי"""
    history = await get_analyst_predictions_history(analyst_id, limit)
    return {
        "status":     "success",
        "analyst_id": analyst_id,
        "count":      len(history),
        "history":    [
            {
                **h,
                "fixture_id":   h.get("fixture_id"),
                "submitted_at": h["submitted_at"].isoformat() if h.get("submitted_at") else None,
                "match_date":   h["match_date"].isoformat() if h.get("match_date") else None,
            }
            for h in history
        ],
    }
