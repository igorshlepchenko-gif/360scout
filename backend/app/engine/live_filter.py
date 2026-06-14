"""
360SCOUT — Live Value Bet Filter
סינון ואימות סיגנלים לפני שליחת התראת Telegram.

חוקים:
  1. Ghost Signal  — בלוק דקה >= 85 (יחסים נדיפים מדי)
  2. Logic Mismatch — קבוצה מובילה לא יכולה לקבל יחס > 1.80 אחרי דקה 70
  3. Edge minimum  — ערך מינימלי של 5% (פחות מזה — אין יתרון אמיתי)
"""

import logging

logger = logging.getLogger(__name__)


def process_live_value_bet(
    elapsed: int,
    home_score: int,
    away_score: int,
    outcome: str,   # "home" | "away" | "draw"
    vb_data: dict,
) -> dict:
    """
    Returns {"status": "SEND_ALERT"} or {"status": "SKIP", "reason": "..."}.
    Call this before sending any live Telegram alert.
    """
    # 1. Ghost Signal — דקות אחרונות: יחסים נדיפים, סיכוי גבוה לנתוני שווא
    if elapsed >= 85:
        return {
            "status": "SKIP",
            "reason": f"Ghost Signal — minute {elapsed} (too volatile, >= 85)",
        }

    # 2. Edge minimum — חייב לעבור את הסף
    edge = float(vb_data.get("edge_percent") or 0)
    if edge < 5.0:
        return {
            "status": "SKIP",
            "reason": f"Edge too low ({edge:.1f}% < 5%)",
        }

    # 3. Logic Mismatch — בדקות מתקדמות, קבוצה מובילה לא אמורה להיות ב-1.80+
    chosen_odds = float(vb_data.get("bookmaker_odds") or 0)
    if elapsed >= 70 and chosen_odds > 1.80:
        if home_score > away_score and outcome == "home":
            return {
                "status": "SKIP",
                "reason": (
                    f"Logic Mismatch — home leads {home_score}:{away_score} "
                    f"but odds={chosen_odds} at minute {elapsed}"
                ),
            }
        if away_score > home_score and outcome == "away":
            return {
                "status": "SKIP",
                "reason": (
                    f"Logic Mismatch — away leads {away_score}:{home_score} "
                    f"but odds={chosen_odds} at minute {elapsed}"
                ),
            }

    return {"status": "SEND_ALERT"}
