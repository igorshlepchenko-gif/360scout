"""
360SCOUT — /api/signals  (The Winning Method — Cloud Function compatible)

Endpoint שה-Cloud Function ה-JS (ו-Python) קוראים לו.
מחזיר משחקים בפורמט אחיד עם שדה `analytics` מלא,
כך שהסינון המתקדם יכול לפעול בצד הלקוח (Cloud Function)
וגם הנתונים כבר מסוננים כאן.

Analytics fields (mapped from existing engine output):
  liveMomentumScore  — כמה חזק הסיגנל כרגע (0–100)
  squadFatigueIndex  — עומס / ניהול סגל (0–100, גבוה = עייף)
  motivationLevel    — 1–5, ניקוד חשיבות המשחק
  valueEdge          — EV% הטוב ביותר שנמצא ב-value_bets
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user

router = APIRouter(prefix="/api/signals", tags=["signals"], dependencies=[Depends(get_current_user)])
logger = logging.getLogger(__name__)

# ── פילטרים ברירת מחדל (ניתן לעקוף ב-query params) ─────────────────────────
_DEFAULT_MIN_CONFIDENCE  = 75.0   # ביטחון מינימלי (%) — v3: raised from 65 → 75
_DEFAULT_MIN_EDGE        = 15.0   # EV% מינימלי (MODERATE threshold)
_DEFAULT_MIN_ODDS        = 1.50   # יחס מינימלי (מהקוד ה-JS)
_DEFAULT_MIN_MOMENTUM    = 45     # liveDominanceScore
_DEFAULT_MAX_FATIGUE     = 80     # playerFatigueIndex — v3: raised from 75 → 80
_DEFAULT_MIN_MOTIVATION  = 3      # motivationLevel (1–5); v3 JS uses > 2 → same as ≥ 3


# ── Analytics derivation ─────────────────────────────────────────────────────

def _derive_analytics(match: dict) -> dict:
    """
    גוזר את שדות analytics מנתוני המשחק הקיימים.

    liveMomentumScore (0–100):
      בסיס: confidence (60%) + בונוס value_bet (20%) + יחס xG (20%)
      → מייצג "כמה חזק הסיגנל כרגע"

    squadFatigueIndex (0–100):
      ממוצע home_injury_impact + away_injury_impact × 100
      → גבוה = קבוצות עייפות/פצועות

    motivationLevel (1–5):
      3 = ניטרלי, +1 לליגת אלופות/מונדיאל, +1 לשלב KO
      → חשיבות המשחק לכל קבוצה

    valueEdge (float %):
      ה-edge_percent הגבוה ביותר מבין value_bets
    """
    prediction  = match.get("prediction") or {}
    final_probs = prediction.get("final") or {}
    confidence  = float(prediction.get("confidence") or 0)
    vb          = match.get("value_bets") or {}
    xg          = match.get("xg") or {}
    league      = (match.get("league") or "").lower()

    # ── valueEdge: max EV% in value_bets ─────────────────────────────────────
    value_edge = 0.0
    best_vb_odds = 0.0
    best_outcome = None
    for outcome, vb_data in vb.items():
        if not vb_data:
            continue
        ep = float(vb_data.get("edge_percent") or 0)
        if ep > value_edge:
            value_edge   = ep
            best_vb_odds = float(vb_data.get("bookmaker_odds") or 0)
            best_outcome = outcome

    # ── liveMomentumScore / liveDominanceScore ───────────────────────────────
    # שני שמות לאותו מדד: עוצמת הסיגנל (0–100)
    # לפרה-גיים: confidence + value bonus + יחס xG
    # ללייב: מוסיפים בונוס סקור (קבוצה מובילה = יתרון מומנטום)
    has_value_bonus = 20 if value_edge >= 5 else 0
    xg_h = float(xg.get("home") or 1.2)
    xg_a = float(xg.get("away") or 1.2)
    xg_ratio = max(xg_h, xg_a) / (min(xg_h, xg_a) + 0.1)
    xg_bonus = min(20, int((xg_ratio - 1) * 10))    # 0–20

    # live dominance bonus: if leading team matches model prediction → stronger signal
    score  = match.get("score") or {}
    sh, sa = int(score.get("home") or 0), int(score.get("away") or 0)
    live_bonus = 0
    if sh != sa and final_probs:
        leading = "home" if sh > sa else "away"
        model_top = max(final_probs, key=final_probs.get)
        live_bonus = 8 if leading == model_top else -5

    momentum = min(100, max(0, int(confidence * 0.60 + has_value_bonus + xg_bonus + live_bonus)))

    # ── playerFatigueIndex / squadFatigueIndex ───────────────────────────────
    # שני שמות לאותו מדד: עומס שחקנים (0–100, גבוה = עייף)
    by_module     = prediction.get("by_module") or {}
    human_factors = by_module.get("human") or {}
    home_mod = float(human_factors.get("home") or 0.33)
    away_mod = float(human_factors.get("away") or 0.33)
    injury_delta = abs(home_mod - away_mod)
    fatigue = min(100, int(30 + max(0, injury_delta - 0.15) * 110))

    # ── motivationLevel (1–5) ─────────────────────────────────────────────────
    motivation = 3
    if any(kw in league for kw in ("champions", "europa", "world", "מונדיאל", "אלופות")):
        motivation = min(5, motivation + 1)
    if any(kw in league for kw in ("knockout", "final", "semi", "quarter", "הכרעה")):
        motivation = min(5, motivation + 1)

    # ── pick label ───────────────────────────────────────────────────────────
    OUTCOME_LABEL = {"home": "ניצחון בית (1)", "draw": "תיקו (X)", "away": "ניצחון חוץ (2)"}
    pick_he = OUTCOME_LABEL.get(best_outcome or "", "")
    if not pick_he and final_probs:
        top = max(final_probs, key=final_probs.get)
        pick_he = OUTCOME_LABEL.get(top, top)
        if not best_vb_odds:
            odds_map = match.get("odds") or {}
            best_vb_odds = float(odds_map.get(f"odds_{top}") or 0)

    return {
        # שמות ראשיים (v2 Cloud Function)
        "playerFatigueIndex":  fatigue,
        "motivationLevel":     motivation,
        "liveDominanceScore":  momentum,
        "valueEdge":           round(value_edge, 2),
        # aliases לתאימות לאחור (v1 Cloud Function)
        "liveMomentumScore":   momentum,
        "squadFatigueIndex":   fatigue,
        "_pick":               pick_he,
        "_best_odds":          best_vb_odds,
        "_best_outcome":       best_outcome,
    }


def _format_signal(match: dict) -> dict | None:
    """
    ממיר match dict לפורמט שה-Cloud Function (JS/Python) מצפה לו.

    שדות חובה לקוד ה-JS:
      id, homeTeam, awayTeam, kickoffTime, confidence,
      odds, pick, analytics.{liveMomentumScore, squadFatigueIndex,
                              motivationLevel, valueEdge}
    """
    if not match:
        return None

    analytics = _derive_analytics(match)
    confidence = float((match.get("prediction") or {}).get("confidence") or 0)

    # isValueBet: True אם יש לפחות value bet אחד חיובי
    any_value = any(
        (v or {}).get("is_value_bet")
        for v in (match.get("value_bets") or {}).values()
    )

    # weather temperature (°C) — ישירות מה-weather dict
    weather_celsius = (match.get("weather") or {}).get("temperature_celsius")

    return {
        "id":          match.get("fixture_id"),
        "homeTeam":    match.get("home_team", ""),
        "awayTeam":    match.get("away_team", ""),
        "kickoffTime": match.get("match_date", ""),
        "league":      match.get("league", ""),
        "confidence":  confidence,
        "odds":        str(analytics["_best_odds"]) if analytics["_best_odds"] else "-",
        "pick":        analytics["_pick"],
        "isValueBet":  any_value,
        "weather":     weather_celsius,
        "referee":     match.get("referee", ""),
        "isLive":      match.get("_status") == "live",
        "elapsed":     match.get("elapsed"),
        "score":       match.get("score"),
        "analytics": {
            # v3 field names (new Cloud Function)
            "playerFatigueIndex": analytics["playerFatigueIndex"],
            "liveDominanceScore": analytics["liveDominanceScore"],
            "motivationLevel":    analytics["motivationLevel"],
            "valueEdge":          analytics["valueEdge"],
            # v1/v2 backward-compat aliases
            "liveMomentumScore":  analytics["liveMomentumScore"],
            "squadFatigueIndex":  analytics["squadFatigueIndex"],
        },
        # שמור גם את הנתונים המלאים לשימוש מתקדם
        "value_bets":   match.get("value_bets"),
        "ou_edge":      match.get("ou_edge"),
        "goals_signal": match.get("goals_signal"),
        "xg":           match.get("xg"),
        "weather_data": match.get("weather"),   # dict מלא — לא override "weather" (מספר)
        "prediction":   match.get("prediction"),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("")
async def get_signals(
    min_confidence: float = _DEFAULT_MIN_CONFIDENCE,
    min_edge:       float = _DEFAULT_MIN_EDGE,
    min_odds:       float = _DEFAULT_MIN_ODDS,
    min_momentum:   int   = _DEFAULT_MIN_MOMENTUM,
    max_fatigue:    int   = _DEFAULT_MAX_FATIGUE,
    min_motivation: int   = _DEFAULT_MIN_MOTIVATION,
    days:           int   = 2,
    limit:          int   = 50,
):
    """
    GET /api/signals

    מחזיר רק משחקים שעברו את כל הסינונים המתקדמים.
    תואם לפורמט שהקוד ה-JS מצפה לו:
      response.data.matches → [{id, homeTeam, awayTeam, confidence, odds, pick, analytics}]

    Query params (כולם אופציונליים — ברירות מחדל מוגדרות בקובץ):
      min_confidence  (65)   — ביטחון מינימלי של המודל
      min_edge        (15.0) — EV% מינימלי
      min_odds        (1.50) — יחס סוכן מינימלי (חוסם 1.10/1.20)
      min_momentum    (45)   — liveMomentumScore מינימלי
      max_fatigue     (75)   — squadFatigueIndex מקסימלי
      min_motivation  (3)    — motivationLevel מינימלי (1–5)
      days            (2)    — כמה ימים לסרוק
      limit           (50)   — מקסימום תוצאות
    """
    from app.api.routes.live import get_live_matches

    try:
        raw = await get_live_matches(days=days)
        all_matches = raw.get("matches", [])
    except Exception as e:
        logger.error(f"[Signals] Failed to fetch live matches: {e}")
        return {"status": "error", "matches": [], "count": 0, "message": str(e)}

    signals = []
    for m in all_matches:
        sig = _format_signal(m)
        if not sig:
            continue

        an = sig["analytics"]

        # ── Filters (mirror the JS Cloud Function logic) ──────────────────────
        odds_val = float(sig["odds"]) if sig["odds"] not in ("-", "", None) else 0.0

        passes = (
            sig["confidence"]              >= min_confidence
            and odds_val                   >= min_odds
            and an["valueEdge"]            >= min_edge
            and an["liveDominanceScore"]   >= min_momentum
            and an["playerFatigueIndex"]   <= max_fatigue
            and an["motivationLevel"]      >= min_motivation
        )

        if passes:
            signals.append(sig)

    # Sort: highest valueEdge first
    signals.sort(key=lambda s: s["analytics"]["valueEdge"], reverse=True)
    signals = signals[:limit]

    logger.info(f"[Signals] {len(signals)} signals passed filters (from {len(all_matches)} matches)")

    return {
        "status":  "success",
        "count":   len(signals),
        "matches": signals,
        "filters_applied": {
            "min_confidence": min_confidence,
            "min_edge":       min_edge,
            "min_odds":       min_odds,
            "min_momentum":   min_momentum,
            "max_fatigue":    max_fatigue,
            "min_motivation": min_motivation,
        },
    }


@router.get("/raw")
async def get_raw_signals(days: int = 2):
    """
    GET /api/signals/raw
    כל המשחקים עם analytics fields — ללא סינון.
    שימושי לדיבאג ולכיול הפרמטרים.
    """
    from app.api.routes.live import get_live_matches

    try:
        raw = await get_live_matches(days=days)
        all_matches = raw.get("matches", [])
    except Exception as e:
        return {"status": "error", "matches": [], "message": str(e)}

    signals = [_format_signal(m) for m in all_matches if m]
    signals = [s for s in signals if s]

    return {
        "status":  "success",
        "count":   len(signals),
        "matches": signals,
    }
