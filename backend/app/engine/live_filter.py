"""
360SCOUT — Live Value Bet Filter
סינון ואימות סיגנלים לפני שליחת התראת Telegram.

חוקים (בסדר הפעלה):
  1. Ghost Signal      — בלוק דקה >= 85 (יחסים נדיפים מדי)
  2. Edge minimum      — ערך מינימלי 5% (אחרת אין יתרון אמיתי)
  3. Logic Mismatch    — קבוצה מובילה לא יכולה לקבל יחס > 2.0 אחרי דקה 70
  4. Anti-Contradiction — אם המודל וסקור שניהם מצביעים על אותה קבוצה,
                          אסור לשלוח התראה לקבוצה ההפוכה (נתון מיושן/מיפוי שגוי)
"""

import logging

logger = logging.getLogger(__name__)


def process_live_value_bet(
    elapsed: int,
    home_score: int,
    away_score: int,
    outcome: str,           # "home" | "away" | "draw"
    vb_data: dict,
    primary_winner: str = "",  # "home" | "away" | "draw" — max-prob outcome from model
) -> dict:
    """
    Returns {"status": "SEND_ALERT"} or {"status": "SKIP", "reason": "..."}.
    Call this before any live Telegram alert.
    """
    # 1. Ghost Signal — דקות אחרונות: יחסים נדיפים, סיכוי גבוה לנתוני שווא
    if elapsed >= 85:
        return {
            "status": "SKIP",
            "reason": f"Ghost Signal — minute {elapsed} (>= 85, odds too volatile)",
        }

    # 2. Edge minimum
    edge = float(vb_data.get("edge_percent") or 0)
    if edge < 5.0:
        return {
            "status": "SKIP",
            "reason": f"Edge too low ({edge:.1f}% < 5%)",
        }

    # 3. Logic Mismatch — בדקות מתקדמות, קבוצה מובילה לא אמורה לעמוד ביחס גבוה
    chosen_odds = float(vb_data.get("bookmaker_odds") or 0)
    if elapsed >= 70 and chosen_odds > 2.0:
        if home_score > away_score and outcome == "home":
            return {
                "status": "SKIP",
                "reason": (
                    f"Logic Mismatch — home leads {home_score}:{away_score} "
                    f"but odds={chosen_odds} at minute {elapsed} (RTL/mapping bug?)"
                ),
            }
        if away_score > home_score and outcome == "away":
            return {
                "status": "SKIP",
                "reason": (
                    f"Logic Mismatch — away leads {away_score}:{home_score} "
                    f"but odds={chosen_odds} at minute {elapsed} (RTL/mapping bug?)"
                ),
            }

    # 4. Anti-Contradiction — המודל + הסקור שניהם מצביעים על אותה קבוצה,
    #    אך ה-value bet הוא לקבוצה ההפוכה (נתוני יחסים מיושנים + מודל שלא מגיב ל-live)
    if elapsed >= 70 and primary_winner in ("home", "away"):
        if primary_winner == "home" and home_score > away_score and outcome == "away":
            return {
                "status": "SKIP",
                "reason": (
                    f"Anti-Contradiction — model picks home + home leads {home_score}:{away_score}, "
                    f"blocking away alert at minute {elapsed} (stale odds suspected)"
                ),
            }
        if primary_winner == "away" and away_score > home_score and outcome == "home":
            return {
                "status": "SKIP",
                "reason": (
                    f"Anti-Contradiction — model picks away + away leads {away_score}:{home_score}, "
                    f"blocking home alert at minute {elapsed} (stale odds suspected)"
                ),
            }

    return {"status": "SEND_ALERT"}
