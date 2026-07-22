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

# dedup: "fixture_id:outcome" — מונע שליחת אותה התראה פעמיים
_sent_signals: set[str] = set()

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


# ── Goals line table formatter ────────────────────────────────────────────────

def format_goals_row(home_team: str, away_team: str, gs: dict | None) -> str:
    """
    Format a goals-market row for Telegram.

    Output (Markdown pre block so columns align in monospace):
    ```
    ⚽ Over/Under 2.5 Goals
    ─────────────────────────────────────
     אנדר   45.2%  @ 2.10   MODERATE +18%
     אובר   54.8%  @ 1.75   NONE      -3%
    ─────────────────────────────────────
     xG בית 1.42 │ xG חוץ 1.18 │ סה"כ 2.60
    ```
    Returns empty string if gs is None or signal is completely absent.
    """
    if not gs:
        return ""

    under_prob = gs.get("under_prob", 0) * 100
    over_prob  = gs.get("over_prob",  0) * 100
    under_edge = gs.get("under_edge", 0)
    over_edge  = gs.get("over_edge",  0)
    under_rat  = gs.get("under_rating", "NONE")
    over_rat   = gs.get("over_rating",  "NONE")
    under_odds = gs.get("under_odds", 0)
    over_odds  = gs.get("over_odds",  0)
    xg_home    = gs.get("xg_home", 0)
    xg_away    = gs.get("xg_away", 0)
    total      = gs.get("expected_total", 0)
    line       = gs.get("line", 2.5)
    signal     = gs.get("signal", "NO_SIGNAL")
    mods       = gs.get("modifiers_applied") or []

    # signal emoji
    def _sig_icon(rat: str) -> str:
        return {"STRONG": "🔥", "MODERATE": "✅", "WEAK": "📊"}.get(rat, "")

    under_sign = f"+{under_edge:.1f}%" if under_edge > 0 else f"{under_edge:.1f}%"
    over_sign  = f"+{over_edge:.1f}%"  if over_edge  > 0 else f"{over_edge:.1f}%"

    under_row = (
        f" {'אנדר':<6} {under_prob:4.1f}%  @ {under_odds:.2f}  "
        f"{under_rat:<8} {under_sign}  {_sig_icon(under_rat)}"
    )
    over_row = (
        f" {'אובר':<6} {over_prob:4.1f}%  @ {over_odds:.2f}  "
        f"{over_rat:<8} {over_sign}  {_sig_icon(over_rat)}"
    )

    mods_line = ""
    if mods:
        mods_line = f"\n⚠️ _מתקנים פעילים: {', '.join(mods)}_"

    signal_line = ""
    if signal != "NO_SIGNAL":
        s_edge = gs.get("signal_edge", 0)
        s_rat  = gs.get("signal_rating", "")
        s_icon = _sig_icon(s_rat)
        s_name = "אובר" if signal == "OVER" else "אנדר"
        signal_line = f"\n🎯 *סיגנל שערים:* {s_icon} *{s_name} {line} — VALUE +{s_edge:.1f}%* ({s_rat})"

    return (
        f"\n━━━━━━━━━━━━━━━━━━━━\n"
        f"⚽ *ניתוח שערים — Over/Under {line}*\n"
        f"```\n"
        f"{under_row}\n"
        f"{over_row}\n"
        f"```\n"
        f"📐 xG בית `{xg_home:.2f}` │ xG חוץ `{xg_away:.2f}` │ סה\"כ `{total:.2f}`"
        f"{signal_line}"
        f"{mods_line}"
    )


async def send_value_bet_alert(match: dict, outcome: str, vb: dict) -> bool:
    """הודעת Value Bet מעוצבת — עם dedup: לא ישלח אותה התראה פעמיים"""
    fixture_id = match.get("fixture_id") or match.get("home_team", "?")
    signal_key = f"{fixture_id}:{outcome}"
    if signal_key in _sent_signals:
        logger.debug(f"Telegram dedup — pre-match signal already sent: {signal_key}")
        return False

    stars   = "⭐⭐⭐" if vb.get("rating") == "STRONG" else "⭐⭐" if vb.get("rating") == "MODERATE" else "⭐"
    emoji   = {"home": "🏠", "away": "✈️", "draw": "🤝"}.get(outcome, "⚽")
    he_name = {"home": "בית", "away": "אורחים", "draw": "תיקו"}.get(outcome, outcome)

    home_team    = match.get('home_team', '?')
    away_team    = match.get('away_team', '?')
    # שם הקבוצה המומלצת — ברור ואינו תלוי בכיווניות BiDi של טלגרם
    outcome_team = home_team if outcome == "home" else (away_team if outcome == "away" else "תיקו")

    goals_row = format_goals_row(home_team, away_team, match.get("goals_signal"))

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
🎯 אמינות הסיגנל: {match.get('confidence','?')}%{goals_row}

_360SCOUT · ניתוח 360 מעלות_
"""
    sent = await send_message(text.strip())
    if sent:
        _sent_signals.add(signal_key)
    return sent


async def send_live_value_alert(
    match: dict,
    outcome: str,
    vb: dict,
    bankroll: float = 0.0,
) -> bool:
    """
    התראת Value Bet בליין רץ — עם dedup ו-Kelly sizing אופציונלי.

    Args:
        bankroll: קופה ב-₪ לחישוב Kelly (0 = לא מוצג)
    """
    fixture_id = match.get("fixture_id") or match.get("home_team", "?")
    signal_key = f"{fixture_id}:{outcome}"
    if signal_key in _sent_signals:
        logger.debug(f"Telegram dedup — signal already sent: {signal_key}")
        return False

    stars    = "⭐⭐⭐" if vb.get("rating") == "STRONG" else "⭐⭐" if vb.get("rating") == "MODERATE" else "⭐"
    emoji    = {"home": "🏠", "away": "✈️", "draw": "🤝"}.get(outcome, "⚽")
    he_name  = {"home": "ניצחון בית (1)", "away": "ניצחון חוץ (2)", "draw": "תיקו (X)"}.get(outcome, outcome)

    home_team = match.get("home_team", "?")
    away_team = match.get("away_team", "?")
    score     = match.get("score", {}) or {}
    score_txt = f"{score.get('home', 0)} - {score.get('away', 0)}"
    elapsed   = match.get("elapsed")
    time_txt  = f"{elapsed}'" if elapsed else "LIVE"

    # Kelly Criterion — מוצג רק אם הועברה קופה
    kelly_row = ""
    if bankroll > 0:
        try:
            from app.engine.kelly import kelly_criterion
            our_prob = vb.get("our_prob", 0)
            bk_odds  = vb.get("bookmaker_odds", 0)
            if our_prob and bk_odds:
                kr = kelly_criterion(bankroll, our_prob, bk_odds)
                if kr.verdict == "BET":
                    kelly_row = (
                        f"\n💼 Kelly (¼):  `{kr.quarter_kelly*100:.1f}%` → "
                        f"*₪{kr.bet_size:.0f}* מתוך ₪{bankroll:,.0f}"
                    )
        except Exception as ke:
            logger.debug(f"Kelly calc skipped: {ke}")

    goals_row = format_goals_row(home_team, away_team, match.get("goals_signal"))

    text = f"""
🔴 *VALUE BET — LIVE* {stars}

⏱ `{time_txt}` | 📊 `{score_txt}`
🏠 *{home_team}* נגד *{away_team}*
🏆 {match.get('league', '')}

{emoji} *{he_name}*
━━━━━━━━━━━━━━━━━━━━
💰 יחס:       `{vb.get('bookmaker_odds', '?')}`
📊 מודל:      `{vb.get('our_prob', 0)*100:.1f}%` _(שוק: {vb.get('implied_prob', 0)*100:.1f}%)_
📈 יתרון:     *+{vb.get('edge_percent', 0):.1f}%*
⭐ דירוג:     *{vb.get('rating', '?')}*{kelly_row}{goals_row}
━━━━━━━━━━━━━━━━━━━━
[360SCOUT — ניתוח מלא](https://www.analyst365.net/)
"""
    sent = await send_message(text.strip())
    if sent:
        _sent_signals.add(signal_key)
    return sent


async def send_daily_recap(recap: dict) -> bool:
    """סיכום תוצאות יומי — ניבויים שנגמרו היום עם ביצועים"""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    today = datetime.now(ZoneInfo("Asia/Jerusalem")).strftime("%d/%m/%Y")

    total    = recap.get("total", 0)
    hits     = recap.get("hits", 0)
    hit_rate = recap.get("hit_rate", 0.0)
    cum_odds = recap.get("cumulative_odds", 0.0)
    vb_total = recap.get("vb_total", 0)
    vb_hits  = recap.get("vb_hits", 0)
    lines    = recap.get("match_lines", [])

    hit_bar = "🟩" * hits + "🟥" * (total - hits)

    vb_row = (
        f"⚡ Value Bets:    *{vb_hits}/{vb_total}* "
        f"({round(vb_hits / vb_total * 100, 1) if vb_total else 0}%)\n"
        if vb_total else ""
    )

    results_block = "\n".join(lines) if lines else "_אין תוצאות להיום_"

    text = f"""
📊 *סיכום תוצאות יומי — 360SCOUT*
📅 *{today}*

🏟 ניבויים שנגמרו:  *{total}*
🎯 פגיעות:          *{hits}/{total}* ({hit_rate}%)
{hit_bar}
💰 יחס מצטבר:       *×{cum_odds}*
{vb_row}
━━━━━━━━━━━━━━━━━━━━
📋 *פירוט משחקים:*
{results_block}
━━━━━━━━━━━━━━━━━━━━
_[360SCOUT · Analyst365](https://analyst365.net/)_
"""
    return await send_message(text.strip())


async def send_daily_summary(matches_count: int, value_bets_count: int, top_confidence: float) -> bool:
    """סיכום יומי"""
    text = f"""
📊 *סיכום יומי — 360SCOUT*

🏟 משחקים בניתוח:   *{matches_count}*
⚡ הימורי ערך:       *{value_bets_count}*
🎯 ביטחון מקסימלי:  *{top_confidence:.1f}%*

_[360SCOUT](https://www.analyst365.net/)_
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
