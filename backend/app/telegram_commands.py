"""
360SCOUT — Telegram Interactive Command Bot
מאזין לפקודות בצ'אט פרטי מול הבוט ועונה מהדאטה האמיתי:

  /start    — ברוכים הבאים + רשימת פקודות
  /signals  — Value Bets פעילים (מה-DB)
  /live     — משחקים חיים עכשיו: דקה + תוצאה
  /track    — Track Record: דיוק, יחידות, Yield
  /locks    — נעילות קונסנזוס פעילות

ריצה: לולאת getUpdates (long-polling) בתוך אפליקציית FastAPI.
מופעל רק כש-APP_ENV=production (Railway) או TELEGRAM_POLLING=1 —
כדי ששרת פיתוח מקומי לא יתחרה עם הפרודקשן על אותו token (409).
"""

import os
import asyncio
import logging
import httpx

from app.telegram_bot import BOT_TOKEN, ENABLED, API_BASE

logger = logging.getLogger(__name__)

POLLING_ENABLED = ENABLED and (
    os.getenv("TELEGRAM_POLLING", "").strip() == "1"
    or (os.getenv("APP_ENV", "development") == "production"
        and os.getenv("TELEGRAM_POLLING", "").strip() != "0")
)

BOT_COMMANDS = [
    {"command": "signals", "description": "⚡ Value Bets פעילים עכשיו"},
    {"command": "live",    "description": "🔴 משחקים חיים — דקה ותוצאה"},
    {"command": "track",   "description": "📊 Track Record — דיוק ויחידות"},
    {"command": "locks",   "description": "🔒 נעילות קונסנזוס פעילות"},
]

OUTCOME_HE = {"home": "ניצחון בית (1)", "draw": "תיקו (X)", "away": "ניצחון חוץ (2)"}


# ────────────────────────────────────────────────────────────────────────────
# Command handlers — כל אחד מחזיר טקסט Markdown
# ────────────────────────────────────────────────────────────────────────────

async def _cmd_start() -> str:
    return (
        "👋 *ברוכים הבאים ל-ANALYST365*\n\n"
        "אני הבוט של מערכת החיזוי — ניתוח 360°: xG, מזג אוויר, פציעות, "
        "פסיכולוגיה ו-Monte Carlo.\n\n"
        "*פקודות:*\n"
        "⚡ /signals — Value Bets פעילים\n"
        "🔴 /live — משחקים חיים עכשיו\n"
        "📊 /track — ביצועי האלגוריתם\n"
        "🔒 /locks — נעילות קונסנזוס\n\n"
        "🌐 [analyst365.net](https://analyst365.net)\n"
        "_למטרות מחקר בלבד — אין לראות בתכנים המלצה פיננסית._"
    )


async def _cmd_signals() -> str:
    """Value Bets פעילים — ממשחקים שטרם הוכרעו, מה-DB"""
    from app.db.database import get_db
    pool = await get_db()
    if pool is None:
        return "⚠️ בסיס הנתונים אינו זמין כרגע."

    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT m.home_team_name, m.away_team_name, m.league_name, m.match_date,
                   bo.bookmaker, bo.odds_home, bo.odds_draw, bo.odds_away,
                   bo.value_home, bo.value_draw, bo.value_away,
                   mp.final_prob_home, mp.final_prob_draw, mp.final_prob_away
            FROM bookmaker_odds bo
            JOIN matches m ON m.id = bo.match_id
            LEFT JOIN prediction_results pr ON pr.match_id = m.id
            LEFT JOIN match_predictions mp  ON mp.match_id = m.id
            WHERE bo.is_value_bet AND pr.match_id IS NULL
            ORDER BY bo.recorded_at DESC
            LIMIT 5
        """)

    if not rows:
        return ("⚡ *אין Value Bets פעילים כרגע*\n\n"
                "ברגע שהמודל יזהה פער מול השוק — תקבל התראה אוטומטית בערוץ.")

    lines = ["⚡ *Value Bets פעילים*\n"]
    for r in rows:
        values = {"home": r["value_home"] or 0, "draw": r["value_draw"] or 0, "away": r["value_away"] or 0}
        best   = max(values, key=values.get)
        odds   = {"home": r["odds_home"], "draw": r["odds_draw"], "away": r["odds_away"]}[best]
        lines.append(
            f"⚽ *{r['home_team_name']}* נגד *{r['away_team_name']}*\n"
            f"   🏆 {r['league_name'] or '—'}\n"
            f"   🎯 {OUTCOME_HE[best]} · יחס `{odds or '?'}` · יתרון *+{values[best]*100:.1f}%*\n"
        )
    lines.append("_היחסים נכונים לרגע הסריקה · למטרות מחקר בלבד_")
    return "\n".join(lines)


async def _cmd_live() -> str:
    """משחקים חיים — מהפיד (cache של עד 2 דקות)"""
    from app.api.routes.live import fetch_todays_fixtures
    fixtures = await fetch_todays_fixtures()
    live = [f for f in fixtures if f.get("_status") == "live"][:6]

    if not live:
        return "🔴 *אין משחקים חיים ברגע זה*\n\nנסה שוב בהמשך — או צפה בלוח ב-[analyst365.net](https://analyst365.net)"

    lines = ["🔴 *משחקים חיים עכשיו*\n"]
    for f in live:
        fix    = f.get("fixture", {})
        teams  = f.get("teams", {})
        goals  = f.get("goals", {})
        status = fix.get("status", {})
        minute = "מחצית" if status.get("short") == "HT" else f"{status.get('elapsed', '?')}'"
        lines.append(
            f"⏱ *{minute}* | `{goals.get('home', 0)} - {goals.get('away', 0)}` | "
            f"{teams.get('home', {}).get('name', '?')} 🆚 {teams.get('away', {}).get('name', '?')}\n"
            f"   🏆 {f.get('league', {}).get('name', '')}\n"
        )
    return "\n".join(lines)


async def _cmd_track() -> str:
    """Track Record אמיתי מה-DB — דיוק + יחידות (flat staking)"""
    from app.db.repository import get_track_record
    data    = await get_track_record(limit=100)
    s       = data.get("summary", {})
    rows    = data.get("recent", [])

    total = s.get("total", 0)
    if total == 0:
        return "📊 *Track Record*\n\nעדיין אין תוצאות מאומתות — הניבויים מצטברים אוטומטית."

    # units — רק על ניבויים שהיו להם יחסי שוק (כמו בדף הביצועים)
    units, bets = 0.0, 0
    for r in rows:
        if r.get("status") != "finished" or r.get("was_correct") is None:
            continue
        probs = {"home": r.get("final_prob_home") or 0,
                 "draw": r.get("final_prob_draw") or 0,
                 "away": r.get("final_prob_away") or 0}
        pick = r.get("predicted_outcome") or (max(probs, key=probs.get) if any(probs.values()) else None)
        if not pick:
            continue
        odds = {"home": r.get("odds_home"), "draw": r.get("odds_draw"), "away": r.get("odds_away")}.get(pick)
        if not odds or odds <= 1:
            continue
        bets  += 1
        units += (odds - 1) if r.get("was_correct") else -1

    yield_pct = (units / bets * 100) if bets else 0.0

    msg = (
        "📊 *Track Record — ANALYST365*\n\n"
        f"🎯 דיוק כללי: *{s.get('accuracy', 0)}%* ({s.get('correct', 0)}/{total})\n"
        f"⏳ ממתינים לתוצאה: *{s.get('pending', 0)}*\n"
    )
    if bets:
        sign = "+" if units >= 0 else ""
        msg += (
            f"💰 רווח (יחידות): *{sign}{units:.2f}* על {bets} הימורים עם יחס שוק\n"
            f"📈 Yield: *{sign}{yield_pct:.1f}%*\n"
        )
    msg += "\n🌐 הפירוט המלא: [analyst365.net/track-record](https://analyst365.net/track-record)"
    return msg


async def _cmd_locks() -> str:
    """נעילות קונסנזוס פעילות"""
    from app.db.repository import get_consensus_locks
    locks = await get_consensus_locks(limit=5)

    if not locks:
        return ("🔒 *אין נעילות קונסנזוס פעילות*\n\n"
                "נעילה נוצרת כשהאנליסטים מסכימים עם האלגוריתם על אותו משחק.")

    lines = ["🔒 *נעילות קונסנזוס פעילות* ⭐\n"]
    for lk in locks:
        odds = f" · יחס `{lk['market_odds']:.2f}`" if lk.get("market_odds") else ""
        lines.append(
            f"⚽ *{lk['home_team']}* נגד *{lk['away_team']}*\n"
            f"   🏆 {lk.get('league') or '—'}\n"
            f"   🤖 {OUTCOME_HE[lk['algo_pick']]} ({lk['algo_prob']*100:.0f}%) · "
            f"👥 {lk['agreeing_count']}/{lk['total_analysts']} אנליסטים{odds}\n"
        )
    return "\n".join(lines)


HANDLERS = {
    "/start":   _cmd_start,
    "/help":    _cmd_start,
    "/signals": _cmd_signals,
    "/live":    _cmd_live,
    "/track":   _cmd_track,
    "/locks":   _cmd_locks,
}


async def handle_command(text: str) -> str | None:
    """נתב פקודה לטקסט תשובה. None = לא פקודה מוכרת."""
    cmd = text.strip().split()[0].split("@")[0].lower() if text.strip() else ""
    handler = HANDLERS.get(cmd)
    if handler is None:
        return None
    try:
        return await handler()
    except Exception as e:
        logger.error(f"Telegram command {cmd} failed: {e}", exc_info=True)
        return "⚠️ שגיאה זמנית — נסה שוב בעוד רגע."


# ────────────────────────────────────────────────────────────────────────────
# Polling loop
# ────────────────────────────────────────────────────────────────────────────

async def _reply(client: httpx.AsyncClient, chat_id: int, text: str) -> None:
    try:
        await client.post(f"{API_BASE}/sendMessage", json={
            "chat_id": chat_id, "text": text,
            "parse_mode": "Markdown", "disable_web_page_preview": True,
        })
    except Exception as e:
        logger.error(f"Telegram reply failed: {e}")


async def _register_commands(client: httpx.AsyncClient) -> None:
    try:
        await client.post(f"{API_BASE}/setMyCommands", json={"commands": BOT_COMMANDS})
    except Exception:
        pass


async def polling_loop() -> None:
    """לולאת getUpdates — רצה כ-task בתוך FastAPI"""
    logger.info("✅ Telegram command bot: polling started")
    offset = None
    async with httpx.AsyncClient(timeout=35) as client:
        await _register_commands(client)
        while True:
            try:
                params = {"timeout": 25, "allowed_updates": '["message"]'}
                if offset is not None:
                    params["offset"] = offset
                r = await client.get(f"{API_BASE}/getUpdates", params=params)

                if r.status_code == 409:
                    # מישהו אחר מאזין עם אותו token — נחכה ונוותר לו
                    logger.warning("Telegram polling 409 (another poller) — backing off 60s")
                    await asyncio.sleep(60)
                    continue
                if r.status_code != 200:
                    await asyncio.sleep(10)
                    continue

                for upd in r.json().get("result", []):
                    offset = upd["update_id"] + 1
                    msg  = upd.get("message") or {}
                    text = msg.get("text") or ""
                    chat = msg.get("chat") or {}
                    if not text.startswith("/") or not chat.get("id"):
                        continue
                    reply = await handle_command(text)
                    if reply:
                        await _reply(client, chat["id"], reply)

            except asyncio.CancelledError:
                logger.info("Telegram polling stopped")
                raise
            except Exception as e:
                logger.error(f"Telegram polling error: {e}")
                await asyncio.sleep(10)


_task: asyncio.Task | None = None


def start_command_bot() -> None:
    """נקרא מ-lifespan של FastAPI"""
    global _task
    if not POLLING_ENABLED:
        logger.info("Telegram command bot: polling disabled (set TELEGRAM_POLLING=1 to enable locally)")
        return
    _task = asyncio.get_event_loop().create_task(polling_loop())


def stop_command_bot() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
        _task = None
