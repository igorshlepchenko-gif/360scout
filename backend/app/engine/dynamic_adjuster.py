"""
360SCOUT — Dynamic Probability Adjuster

מקבל הסתברויות בסיסיות מהמנוע ומתאם אותן על-פי 3 גורמים חיצוניים:

  1. Motivation Index   [0–1]  — חשיבות המשחק לכל קבוצה
  2. Sentiment Score   [-1–1]  — סנטימנט מרשתות חברתיות / חדשות
  3. Squad Rotation    [bool]  — האם כוכבים נחים

כל גורם מוסיף/מוריד δ קטן מהסתברות הבית/חוץ, ואז מנרמל ל-sum=1.
"""

from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class AdjustmentParams:
    """פרמטרי ההתאמה לכל קבוצה."""
    # מוטיבציה: 0.5 = ניטרלי, >0.5 = קריטי לקבוצה
    home_motivation: float = 0.5
    away_motivation: float = 0.5

    # סנטימנט: 0 = ניטרלי, +1 = חיובי מאוד, -1 = שלילי מאוד
    home_sentiment: float = 0.0
    away_sentiment: float = 0.0

    # רוטציה: True אם כוכבי הקבוצה נחים
    home_rotation: bool = False
    away_rotation: bool = False


# ───────────── עוצמת השפעה לכל גורם ─────────────
_MOTIVATION_WEIGHT = 0.06   # הפרש מוטיבציה של 1.0 → ±6%
_SENTIMENT_WEIGHT  = 0.04   # סנטימנט מלא (±1) → ±4%
_ROTATION_PENALTY  = 0.07   # רוטציה → -7% לקבוצה המסובבת


def adjust_probabilities(
    base_probs: dict[str, float],
    params: AdjustmentParams | None = None,
    *,
    # ניתן גם להעביר ישירות כ-kwargs במקום dataclass
    home_motivation: float | None = None,
    away_motivation: float | None = None,
    home_sentiment:  float | None = None,
    away_sentiment:  float | None = None,
    home_rotation:   bool | None  = None,
    away_rotation:   bool | None  = None,
) -> dict[str, float]:
    """
    מתאם הסתברויות בסיסיות {home, draw, away} לפי גורמים חיצוניים.

    Args:
        base_probs:  {"home": 0.55, "draw": 0.25, "away": 0.20}
        params:      AdjustmentParams (או kwargs בודדים)

    Returns:
        dict מנורמל {"home": ..., "draw": ..., "away": ...}, sum = 1.0
    """
    # מיזוג kwargs לתוך dataclass
    if params is None:
        params = AdjustmentParams(
            home_motivation = home_motivation if home_motivation is not None else 0.5,
            away_motivation = away_motivation if away_motivation is not None else 0.5,
            home_sentiment  = home_sentiment  if home_sentiment  is not None else 0.0,
            away_sentiment  = away_sentiment  if away_sentiment  is not None else 0.0,
            home_rotation   = home_rotation   if home_rotation   is not None else False,
            away_rotation   = away_rotation   if away_rotation   is not None else False,
        )

    _validate(params)

    home = base_probs.get("home", 0.33)
    draw = base_probs.get("draw", 0.33)
    away = base_probs.get("away", 0.33)

    # ── 1. מוטיבציה — הפרש × משקל → δ ──────────────────────────────────────
    motivation_delta = (params.home_motivation - params.away_motivation) * _MOTIVATION_WEIGHT
    home += motivation_delta
    away -= motivation_delta

    # ── 2. סנטימנט — מוסיף/מוריד בנפרד לכל קבוצה ──────────────────────────
    home += params.home_sentiment * _SENTIMENT_WEIGHT
    away += params.away_sentiment * _SENTIMENT_WEIGHT

    # ── 3. רוטציה סגל ────────────────────────────────────────────────────────
    if params.home_rotation:
        home -= _ROTATION_PENALTY
        draw += _ROTATION_PENALTY * 0.5   # חלק מהחסרון עובר לתיקו
    if params.away_rotation:
        away -= _ROTATION_PENALTY
        draw += _ROTATION_PENALTY * 0.5

    # ── נרמול: clip לטווח [0.03, 0.92] → sum = 1.0 ──────────────────────────
    home = max(0.03, min(0.92, home))
    draw = max(0.03, min(0.92, draw))
    away = max(0.03, min(0.92, away))
    total = home + draw + away

    return {
        "home": round(home / total, 4),
        "draw": round(draw / total, 4),
        "away": round(away / total, 4),
    }


def _validate(p: AdjustmentParams) -> None:
    if not (0.0 <= p.home_motivation <= 1.0 and 0.0 <= p.away_motivation <= 1.0):
        raise ValueError("motivation must be in [0, 1]")
    if not (-1.0 <= p.home_sentiment <= 1.0 and -1.0 <= p.away_sentiment <= 1.0):
        raise ValueError("sentiment must be in [-1, 1]")
