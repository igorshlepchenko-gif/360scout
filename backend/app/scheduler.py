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
        valid_ids     = [fid for fid in fixture_ids if fid]
        apisports_map = {
            fid: raw
            for fid, raw in zip(valid_ids, apisports_raw)
            if isinstance(raw, dict)
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
                if result is not None:
                    # OLBG consensus enrichment — אם הסלוג נמצא, מחליף ALGORITHM_ONLY
                    try:
                        from app.tasks.olbg_scraper import (
                            build_olbg_url, fetch_olbg_consensus, olbg_to_analyst_predictions,
                        )
                        from app.engine.prediction_model import calculate_consensus
                        olbg_url  = build_olbg_url(
                            result.get("home_team", ""),
                            result.get("away_team", ""),
                        )
                        olbg_data = await fetch_olbg_consensus(olbg_url)
                        if olbg_data:
                            analyst_preds       = olbg_to_analyst_predictions(olbg_data)
                            result["consensus"] = calculate_consensus(
                                result["prediction"]["final"], analyst_preds
                            )
                            result["consensus"]["olbg_raw"] = olbg_data
                            logger.info(
                                f"[OLBG] {result['home_team']} vs {result['away_team']}: "
                                f"{olbg_data} → {result['consensus']['type']}"
                            )
                    except Exception as olbg_err:
                        logger.debug(f"[OLBG] enrichment skipped: {olbg_err}")

                    await save_match_prediction(result)
                    saved += 1

                    # HT recalculation — runs once per match (DB guard: halftime_matrix IS NULL)
                    if result.get("_status") == "HT":
                        try:
                            from app.db.database import get_db
                            from app.db.repository import (
                                get_match_uuid_by_fixture,
                                get_pre_match_matrix,
                                update_match_halftime_matrix,
                            )
                            from app.engine.prediction_model import calculate_halftime_matrix

                            _pool = await get_db()
                            _fid  = result.get("fixture_id")
                            _uuid = await get_match_uuid_by_fixture(int(_fid)) if _fid else None
                            if _uuid and _pool:
                                _live = {
                                    "xg_home_h1": result.get("xg_home", 1.3),
                                    "xg_away_h1": result.get("xg_away", 1.1),
                                }
                                _pre = await get_pre_match_matrix(_pool, _uuid)
                                if _pre:
                                    _ht = calculate_halftime_matrix(_live, _pre)
                                    await update_match_halftime_matrix(_pool, _uuid, _ht)
                                    logger.info(
                                        f"[HT] Matrix saved for fixture {_fid} | "
                                        f"H2 xG: {_ht['xg_home_h2']} / {_ht['xg_away_h2']}"
                                    )
                        except Exception as ht_err:
                            logger.debug(f"[HT] recalc error for fixture {result.get('fixture_id')}: {ht_err}")

                    # שלח התראת Telegram אם יש Value Bet חזק
                    vb      = result.get("value_bets") or {}
                    is_live = result.get("_status") == "live"
                    _score  = result.get("score") or {}
                    _final  = result.get("prediction", {}).get("final", {})
                    _primary_winner = max(_final, key=_final.get) if _final else ""
                    for outcome, vb_data in vb.items():
                        if vb_data and vb_data.get("rating") in ("STRONG", "MODERATE"):
                            # Sanity guard: edge > 25% on underdog (odds > 4.0) signals
                            # Option-B draw-collapse artifact — block before it hits Telegram.
                            _edge   = vb_data.get("edge_percent", 0)
                            _bk_odd = float(vb_data.get("bookmaker_odds") or 0)
                            if _edge > 25.0 and _bk_odd > 4.0:
                                logger.warning(
                                    f"[Sanity] Blocking suspicious signal: {result.get('home_team')} vs "
                                    f"{result.get('away_team')} | {outcome} | odds={_bk_odd} edge={_edge:.1f}%"
                                )
                                continue
                            try:
                                match_meta = {
                                    "fixture_id":   result.get("fixture_id"),
                                    "home_team":    result.get("home_team", ""),
                                    "away_team":    result.get("away_team", ""),
                                    "match_date":   result.get("match_date", ""),
                                    "league":       result.get("league", ""),
                                    "confidence":   result.get("prediction", {}).get("confidence", 0),
                                    "elapsed":      result.get("elapsed"),
                                    "score":        result.get("score"),
                                    "goals_signal": result.get("goals_signal"),
                                }
                                if is_live:
                                    from app.engine.live_filter import process_live_value_bet
                                    from app.telegram_bot import send_live_value_alert
                                    filt = process_live_value_bet(
                                        elapsed=int(result.get("elapsed") or 0),
                                        home_score=int(_score.get("home") or 0),
                                        away_score=int(_score.get("away") or 0),
                                        outcome=outcome,
                                        vb_data=vb_data,
                                        primary_winner=_primary_winner,
                                    )
                                    if filt["status"] != "SEND_ALERT":
                                        logger.debug(f"[Live Filter] SKIP {outcome}: {filt.get('reason')}")
                                        continue
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
                    r = await client.get(f"{API_BASE}/fixtures",
                                         headers={"x-apisports-key": API_KEY},
                                         params={"id": fid})
                    try:
                        data = r.json().get("response", [])
                    except Exception:
                        logger.warning(f"[Scheduler] Non-JSON response for fixture {fid} (HTTP {r.status_code})")
                        continue
                    if not data:
                        continue
                    fix    = data[0].get("fixture", {})
                    goals  = data[0].get("goals", {}) or {}
                    status = fix.get("status", {}).get("short", "")
                    if status not in ("FT", "AET", "PEN"):
                        continue
                    hs  = goals.get("home")
                    as_ = goals.get("away")
                    if hs is None or as_ is None:
                        continue
                    try:
                        ok = await update_match_result(fid, int(hs), int(as_))
                    except (TypeError, ValueError):
                        logger.warning(f"[Scheduler] Non-integer goals for fixture {fid}: home={hs} away={as_}")
                        continue
                    if ok:
                        updated += 1
                except Exception as e:
                    logger.debug(f"[Scheduler] Update result {fid} error: {e}")

        logger.info(f"[Scheduler] Updated {updated} results")

    except Exception as e:
        logger.error(f"[Scheduler] job_auto_update_results error: {e}", exc_info=True)


async def job_daily_results_recap():
    """23:00 שעון ישראל — שולח לטלגרם סיכום תוצאות יומי"""
    try:
        logger.info(f"[Scheduler] daily_results_recap — {datetime.now(ISRAEL_TZ).strftime('%H:%M')}")
        from app.db.repository import get_today_results_recap
        from app.telegram_bot import send_daily_recap

        recap = await get_today_results_recap()
        if recap["total"] == 0:
            logger.info("[Scheduler] No resolved predictions today — skipping recap")
            return

        sent = await send_daily_recap(recap)
        logger.info(
            f"[Scheduler] Daily recap sent={sent} | "
            f"{recap['hits']}/{recap['total']} hits ({recap['hit_rate']}%) | "
            f"cumulative ×{recap['cumulative_odds']}"
        )
    except Exception as e:
        logger.error(f"[Scheduler] job_daily_results_recap error: {e}", exc_info=True)


async def job_olbg_enrichment(pool, fixtures: list):
    """לוגיקת הליבה: OLBG enrichment מקבילי (עד 3 דפדפנים בו-זמנית)."""
    if not fixtures:
        return

    logger.info(f"[OLBG] Starting enrichment for {len(fixtures)} fixtures")
    sem = asyncio.Semaphore(3)

    async def _enrich_one(fixture: dict):
        async with sem:
            fixture_id = fixture.get("id")
            if not fixture_id:
                return
            try:
                from app.db.repository import get_match_uuid, inject_auto_consensus_predictions
                from app.tasks.olbg_scraper import build_olbg_url, fetch_olbg_consensus

                match_uuid = await get_match_uuid(pool, fixture_id)
                if not match_uuid:
                    logger.debug(f"[OLBG] Fixture {fixture_id} not in DB, skipping")
                    return

                url = build_olbg_url(fixture.get("home_team", ""), fixture.get("away_team", ""))
                consensus_data = await asyncio.wait_for(
                    fetch_olbg_consensus(url), timeout=12.0
                )
                if consensus_data:
                    await inject_auto_consensus_predictions(
                        pool, match_uuid, fixture.get("league_name", ""), consensus_data
                    )
                    logger.info(f"[OLBG] Injected consensus for match {match_uuid}")
            except asyncio.TimeoutError:
                logger.warning(f"[OLBG] Timeout (12s) for fixture {fixture_id}")
            except Exception as e:
                logger.error(f"[OLBG] Failed fixture {fixture_id}: {e}", exc_info=True)

    await asyncio.gather(*[_enrich_one(f) for f in fixtures])
    logger.info("[OLBG] Enrichment cycle completed")


async def job_olbg_enrichment_wrapper():
    """Wrapper — fetches fresh fixtures at runtime so kwargs are never stale."""
    try:
        from app.db.database import get_db
        from app.db.repository import get_todays_fixtures

        pool     = await get_db()
        fixtures = await get_todays_fixtures(pool)
        await job_olbg_enrichment(pool, fixtures)
    except Exception as e:
        logger.error(f"[OLBG] job_olbg_enrichment_wrapper error: {e}", exc_info=True)


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

    # 23:00 שעון ישראל — סיכום תוצאות יומי לטלגרם
    _scheduler.add_job(
        job_daily_results_recap,
        trigger="cron", hour=23, minute=0,
        timezone=ISRAEL_TZ,
        id="daily_recap", replace_existing=True,
    )

    # כל 5 דקות — OLBG consensus enrichment (מקבילי, 3 browsers)
    _scheduler.add_job(
        job_olbg_enrichment_wrapper,
        trigger="interval", minutes=5,
        id="olbg_enrichment", replace_existing=True,
    )

    _scheduler.start()
    logger.info("✅ Scheduler started — fetch every 5min, results every 60min, recap daily 23:00")
    return _scheduler


def stop_scheduler():
    """עצור את ה-scheduler — נקרא מ-shutdown של FastAPI"""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
