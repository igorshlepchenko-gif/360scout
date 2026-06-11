"""
360SCOUT — Background Scheduler (APScheduler)
רץ בתוך FastAPI — ללא worker נפרד.
משתמש ב-Redis לשמירת jobs (שורד restarts).

Jobs:
  - כל 5 דקות:  מושך משחקים חיים + שומר ניבויים ל-DB
  - כל 60 דקות: מעדכן תוצאות משחקים שנגמרו
  - כל 24 שעות: מנקה cache פגי תוקף מה-DB
"""

import os
import logging
import asyncio
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.redis import RedisJobStore
from apscheduler.executors.asyncio import AsyncIOExecutor

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def _build_jobstores() -> dict:
    """Redis jobstore — fallback ל-memory אם Redis לא זמין"""
    redis_url = os.getenv("REDIS_URL", "")
    if redis_url:
        try:
            # parse Redis URL
            import redis
            r = redis.from_url(redis_url, socket_timeout=3)
            r.ping()
            logger.info("Scheduler: using Redis jobstore")
            return {"default": RedisJobStore(url=redis_url)}
        except Exception as e:
            logger.warning(f"Redis unavailable, using memory jobstore: {e}")
    return {}


# ─── JOBS ────────────────────────────────────────────────────────────────────

async def job_fetch_live_matches():
    """כל 5 דקות — מושך משחקים חיים ושומר ניבויים ל-DB"""
    try:
        logger.info(f"[Scheduler] fetch_live_matches — {datetime.now(ISRAEL_TZ).strftime('%H:%M:%S')}")
        import httpx
        from app.cache import set as cache_set
        from app.db.repository import save_match_prediction
        from app.api.routes.live import (
            fetch_todays_fixtures, fetch_all_odds, fetch_odds_apisports,
            fetch_weather_for_city, build_match_analysis_sync,
            _default_weather,
        )

        fixtures = await fetch_todays_fixtures()
        if not fixtures:
            logger.info("[Scheduler] No fixtures found")
            return

        fixtures = fixtures[:10]  # max 10 משחקים לחסוך קריאות

        cities      = list(dict.fromkeys(
            f.get("fixture", {}).get("venue", {}).get("city") or "London"
            for f in fixtures
        ))
        fixture_ids = [f.get("fixture", {}).get("id") for f in fixtures]

        # משוך במקביל: The Odds API (bulk) + מזג אוויר + API-Sports odds (per fixture)
        all_results = await asyncio.gather(
            fetch_all_odds(),
            *[fetch_weather_for_city(c) for c in cities],
            *[fetch_odds_apisports(fid) for fid in fixture_ids if fid],
            return_exceptions=True,
        )
        all_odds        = all_results[0] if isinstance(all_results[0], list) else []
        weather_results = all_results[1: 1 + len(cities)]
        apisports_raw   = all_results[1 + len(cities):]
        valid_ids       = [fid for fid in fixture_ids if fid]
        apisports_map   = {
            valid_ids[i]: apisports_raw[i]
            for i in range(len(valid_ids))
            if isinstance(apisports_raw[i], dict)
        }

        city_weather = {
            city: (weather_results[i] if isinstance(weather_results[i], dict) else _default_weather())
            for i, city in enumerate(cities)
        }

        saved       = 0
        alerts_sent = 0
        for f in fixtures:
            try:
                city         = f.get("fixture", {}).get("venue", {}).get("city") or "London"
                weather      = city_weather.get(city, _default_weather())
                fid          = f.get("fixture", {}).get("id")
                fixture_odds = apisports_map.get(fid)
                result       = build_match_analysis_sync(f, all_odds, weather, fixture_odds=fixture_odds)
                if result:
                    await save_match_prediction(result)
                    saved += 1

                    # שלח התראת Telegram אם יש Value Bet חזק
                    vb      = result.get("value_bets") or {}
                    is_live = result.get("_status") == "live"
                    for outcome, vb_data in vb.items():
                        if vb_data and vb_data.get("rating") in ("STRONG", "MODERATE"):
                            try:
                                match_meta = {
                                    "fixture_id": result.get("fixture_id"),
                                    "home_team":  result.get("home_team", ""),
                                    "away_team":  result.get("away_team", ""),
                                    "match_date": result.get("match_date", ""),
                                    "league":     result.get("league", ""),
                                    "confidence": result.get("prediction", {}).get("confidence", 0),
                                    "elapsed":    result.get("elapsed"),
                                    "score":      result.get("score"),
                                }
                                if is_live:
                                    from app.telegram_bot import send_live_value_alert
                                    sent = await send_live_value_alert(match_meta, outcome, vb_data)
                                else:
                                    from app.telegram_bot import send_value_bet_alert
                                    sent = await send_value_bet_alert(match_meta, outcome, vb_data)
                                if sent:
                                    alerts_sent += 1
                            except Exception as te:
                                logger.debug(f"[Scheduler] Telegram alert error: {te}")
            except Exception as e:
                logger.debug(f"[Scheduler] Match save error: {e}")

        logger.info(f"[Scheduler] Saved {saved}/{len(fixtures)} predictions | Telegram alerts: {alerts_sent}")

    except Exception as e:
        logger.error(f"[Scheduler] job_fetch_live_matches error: {e}", exc_info=True)


async def job_auto_update_results():
    """כל 60 דקות — עדכון תוצאות משחקים שנגמרו"""
    try:
        logger.info(f"[Scheduler] auto_update_results — {datetime.now(ISRAEL_TZ).strftime('%H:%M')}")
        import httpx
        from app.db.database import get_db
        from app.db.repository import update_match_result

        API_KEY  = os.getenv("API_FOOTBALL_KEY", "")
        API_BASE = "https://v3.football.api-sports.io"

        pool = await get_db()
        if not pool:
            return

        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT api_football_id FROM matches
                WHERE status = 'scheduled'
                  AND match_date < NOW() - INTERVAL '2 hours'
                  AND api_football_id IS NOT NULL
                LIMIT 15
            """)

        if not rows:
            logger.info("[Scheduler] No finished matches to update")
            return

        updated = 0
        async with httpx.AsyncClient(timeout=20) as client:
            for row in rows:
                fid = row["api_football_id"]
                try:
                    r    = await client.get(f"{API_BASE}/fixtures",
                                            headers={"x-apisports-key": API_KEY},
                                            params={"id": fid})
                    data = r.json().get("response", [])
                    if not data:
                        continue
                    fix    = data[0].get("fixture", {})
                    goals  = data[0].get("goals", {})
                    status = fix.get("status", {}).get("short", "")
                    if status not in ("FT", "AET", "PEN"):
                        continue
                    hs = goals.get("home")
                    as_ = goals.get("away")
                    if hs is None or as_ is None:
                        continue
                    ok = await update_match_result(fid, int(hs), int(as_))
                    if ok:
                        updated += 1
                except Exception as e:
                    logger.debug(f"[Scheduler] Update result {fid} error: {e}")

        logger.info(f"[Scheduler] Updated {updated} results")

    except Exception as e:
        logger.error(f"[Scheduler] job_auto_update_results error: {e}", exc_info=True)


async def job_cleanup_cache():
    """כל 24 שעות — מנקה cache פגי תוקף"""
    try:
        logger.info("[Scheduler] cleanup_cache")
        from app.db.database import get_db
        pool = await get_db()
        if not pool:
            return
        async with pool.acquire() as conn:
            deleted = await conn.fetchval(
                "DELETE FROM api_cache WHERE expires_at < NOW() RETURNING count(*)"
            )
        logger.info(f"[Scheduler] Cleaned {deleted or 0} expired cache entries")
    except Exception as e:
        logger.error(f"[Scheduler] cleanup_cache error: {e}", exc_info=True)


# ─── LIFECYCLE ───────────────────────────────────────────────────────────────

def start_scheduler() -> AsyncIOScheduler:
    """אתחל והפעל את ה-scheduler — נקרא מ-startup של FastAPI"""
    global _scheduler

    jobstores  = _build_jobstores()
    executors  = {"default": AsyncIOExecutor()}
    job_defaults = {"coalesce": True, "max_instances": 1, "misfire_grace_time": 60}

    _scheduler = AsyncIOScheduler(
        jobstores=jobstores,
        executors=executors,
        job_defaults=job_defaults,
    )

    # רץ מייד בהפעלה, ואח"כ כל 5 דקות
    _scheduler.add_job(
        job_fetch_live_matches,
        trigger="interval", minutes=5,
        id="fetch_live", replace_existing=True,
        next_run_time=datetime.now(timezone.utc),  # run immediately on startup
    )

    # כל 60 דקות
    _scheduler.add_job(
        job_auto_update_results,
        trigger="interval", minutes=60,
        id="auto_results", replace_existing=True,
    )

    # כל 24 שעות בשעה 03:00 שעון ישראל
    _scheduler.add_job(
        job_cleanup_cache,
        trigger="cron", hour=3, minute=0,
        timezone=ISRAEL_TZ,
        id="cleanup_cache", replace_existing=True,
    )

    _scheduler.start()
    logger.info("✅ Scheduler started — fetch every 5min, results every 60min, cleanup daily")
    return _scheduler


def stop_scheduler():
    """עצור את ה-scheduler — נקרא מ-shutdown של FastAPI"""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
