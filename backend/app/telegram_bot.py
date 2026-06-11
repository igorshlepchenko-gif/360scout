"""
360SCOUT — Telegram Alert Bot
שולח התראות Value Bet לערוץ טלגרם אוטומטית.

הגדרה:
1. צור בוט: @BotFather → /newbot
2. קבל את ה-token
3. צור ערוץ → הוסף את הבוט כ-admin
4. הכנס ב-.env:
   TELEGRAM_BOT_TOKEN=1234567890:AAE...
   TELEGRAM_CHANNEL_ID=@your_channel   (או מספר כמו -1001234567890)
"""

import os
import asyncio
import logging
import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

BOT_TOKEN   = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHANNEL_ID  = os.getenv("TELEGRAM_CHANNEL_ID", "")
ENABLED     = bool(BOT_TOKEN and BOT_TOKEN != "your_telegram_bot_token_here"
                   and CHANNEL_ID and CHANNEL_ID != "@your_channel")

API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"


async def send_message(text: str, parse_mode: str = "Markdown") -> bool:
    """שלח הודעה לערוץ"""
    if not ENABLED:
        logger.info(f"Telegram disabled — would send:\n{text[:100]}...")
        return False

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.post(f"{API_BASE}/sendMessage", json={
                "chat_id":    CHANNEL_ID,
                "text":       text,
                "parse_mode": parse_mode,
            })
            if r.status_code == 200:
                logger.info("Telegram: הודעה נשלחה בהצלחה")
                return True
            else:
                logger.error(f"Telegram error: {r.status_code} — {r.text[:200]}")
                return False
        except Exception as e:
            logger.error(f"Telegram send failed: {e}")
            return False


async def send_value_bet_alert(match: dict, outcome: str, vb: dict) -> bool:
    """הודעת Value Bet מעוצבת"""
    stars   = "⭐⭐⭐" if vb.get("rating") == "STRONG" else "⭐⭐" if vb.get("rating") == "MODERATE" else "⭐"
    emoji   = {"home": "🏠", "away": "✈️", "draw": "🤝"}.get(outcome, "⚽")
    he_name = {"home": "בית", "away": "אורחים", "draw": "תיקו"}.get(outcome, outcome)

    home_team    = match.get('home_team', '?')
    away_team    = match.get('away_team', '?')
    # שם הקבוצה המומלצת — ברור ואינו תלוי בכיווניות BiDi של טלגרם
    outcome_team = home_team if outcome == "home" else (away_team if outcome == "away" else "תיקו")

    text = f"""
🔥 *התראת VALUE BET* {stars}

🏠 *בית:* {home_team}
✈️ *אורחים:* {away_team}
🏆 {match.get('league','')} | 📅 {match.get('match_date','')} 🕐 (שעון ישראל)

{emoji} *תוצאה: {outcome_team} ({he_name})*
━━━━━━━━━━━━━━━━━━━━
📊 המודל שלנו:     `{vb.get('our_prob',0):.1%}`
📉 שוק:            `{vb.get('implied_prob',0):.1%}`
💰 יחס הסוכן:      `{vb.get('bookmaker_odds','?')}`
📈 יתרון:          *+{vb.get('edge_percent',0):.1f}%*
⭐ דירוג:          *{vb.get('rating','?')}*
━━━━━━━━━━━━━━━━━━━━
🎯 רמת ביטחון: {match.get('confidence','?')}%

_360SCOUT · ניתוח 360 מעלות_
"""
    return await send_message(text.strip())


async def send_daily_summary(matches_count: int, value_bets_count: int, top_confidence: float) -> bool:
    """סיכום יומי"""
    text = f"""
📊 *סיכום יומי — 360SCOUT*

🏟 משחקים בניתוח:   *{matches_count}*
⚡ הימורי ערך:       *{value_bets_count}*
🎯 ביטחון מקסימלי:  *{top_confidence:.1f}%*

_לחץ כאן לצפייה: [360SCOUT](http://localhost:3000)_
"""
    return await send_message(text.strip())


async def send_lineup_alert(match: dict, team: str, key_player: str, impact: str) -> bool:
    """התראת שינוי הרכב ברגע האחרון"""
    text = f"""
⚠️ *עדכון הרכב ברגע האחרון*

⚽ {match.get('home_team','?')} נגד {match.get('away_team','?')}
👤 *{key_player}* ({team}) — {impact}

🔄 המודל מחשב מחדש...
_עדכון יגיע בתוך דקות_
"""
    return await send_message(text.strip())


async def test_bot() -> dict:
    """בדוק שהבוט פעיל — קרא ל-getMe"""
    if not ENABLED:
        return {"ok": False, "error": "Telegram לא מוגדר ב-.env"}

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"{API_BASE}/getMe")
            if r.status_code == 200:
                bot_info = r.json().get("result", {})
                return {
                    "ok":       True,
                    "bot_name": bot_info.get("first_name"),
                    "username": f"@{bot_info.get('username')}",
                    "channel":  CHANNEL_ID,
                }
            return {"ok": False, "error": f"HTTP {r.status_code}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    import asyncio

    async def demo():
        print("בודק Telegram Bot...")
        result = await test_bot()
        print(f"תוצאה: {result}")

        if result["ok"]:
            print("שולח הודעת בדיקה...")
            await send_message("✅ *360SCOUT Bot פעיל!*\n\nהבוט מחובר ומוכן לשלוח התראות Value Bet.")
            print("נשלח!")
        else:
            print("⚠️ הוסף TELEGRAM_BOT_TOKEN ו-TELEGRAM_CHANNEL_ID לקובץ .env")

    asyncio.run(demo())
