"""
360SCOUT — Repository Layer
פונקציות לשמירה וקריאה של ניבויים מ-PostgreSQL.
כל פונקציה עובדת ב-graceful degradation — אם DB לא זמין, לא קורסת.
"""

import json
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from .database import get_db

logger = logging.getLogger(__name__)

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")


def _parse_jsonb(field):
    """asyncpg מחזיר עמודות JSONB כ-str גולמי (אין type codec רשום) — פענח ל-dict/list."""
    if field is None:
        return None
    if isinstance(field, str):
        return json.loads(field)
    if isinstance(field, (bytes, bytearray)):
        return json.loads(field.decode())
    return field


# ────────────────────────────────────────────────────────────────────────────
# שמירת ניבוי
# ────────────────────────────────────────────────────────────────────────────

async def save_match_prediction(match_data: dict) -> Optional[str]:
    """
    שמור ניבוי מלא ל-DB.
    מחזיר את ה-UUID של הרשומה, או None אם נכשל.
    משתמש ב-UPSERT — אם הניבוי כבר קיים מעדכן אותו.
    """
    pool = await get_db()
    if pool is None:
        return None

    try:
        fixture_id  = match_data.get("fixture_id")
        prediction  = match_data.get("prediction", {})
        final       = prediction.get("final", {})
        mc          = prediction.get("monte_carlo", {})
        by_module   = prediction.get("by_module", {})
        odds        = match_data.get("odds") or {}
        value_bets  = match_data.get("value_bets") or {}
        consensus   = match_data.get("consensus") or {}

        # parse תאריך — match_date מגיע כמחרוזת שכבר מומרת לשעון ישראל (live.py),
        # לכן חייבים לתייג אותה עם ISRAEL_TZ לפני האחסון. אחרת asyncpg מכניס אותה
        # ל-TIMESTAMPTZ כאילו הייתה UTC — הפרש של 2-3 שעות שיכול לגלוש ליום הלועזי הבא.
        match_date = None
        date_str = match_data.get("match_date", "")
        if date_str:
            try:
                match_date = datetime.strptime(date_str, "%d/%m/%Y %H:%M").replace(tzinfo=ISRAEL_TZ)
            except Exception:
                pass

        async with pool.acquire() as conn:
            # 1. Upsert לטבלת matches
            match_uuid = await conn.fetchval("""
                INSERT INTO matches (
                    api_football_id, home_team_name, away_team_name,
                    league_name, league_id, match_date,
                    venue, city, status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                ON CONFLICT (api_football_id) DO UPDATE
                    SET home_team_name = EXCLUDED.home_team_name,
                        away_team_name = EXCLUDED.away_team_name,
                        league_name    = EXCLUDED.league_name,
                        match_date     = EXCLUDED.match_date
                RETURNING id
            """,
                fixture_id,
                match_data.get("home_team", ""),
                match_data.get("away_team", ""),
                match_data.get("league", ""),
                None,  # league_id — אפשר להוסיף בהמשך
                match_date,
                match_data.get("venue", ""),
                match_data.get("city", ""),
                "scheduled",
            )

            if not match_uuid:
                return None

            # 2. Upsert לטבלת match_predictions — אבל לא אם המשחק כבר ננעל (locked_at).
            # _status מגיע מ-fetch_todays_fixtures דרך build_match_analysis(_sync):
            # "scheduled" | "live" | "finished".
            _status = match_data.get("_status", "scheduled")
            existing_pred = await conn.fetchrow("""
                SELECT locked_at, final_prob_home, final_prob_draw, final_prob_away,
                       monte_carlo_home, monte_carlo_draw, monte_carlo_away, simulations_run
                FROM match_predictions WHERE match_id = $1
            """, match_uuid)

            if existing_pred and existing_pred["locked_at"] is not None:
                # כבר ננעל — אין נגיעה בהמלצה/הסתברויות. שקט, לא כותבים כלום.
                pass
            elif _status in ("live", "finished"):
                if existing_pred is not None and existing_pred["final_prob_home"] is not None:
                    # רגע הנעילה — קופאים על המספרים האחרונים לפני המשחק (השורה
                    # הקיימת), לעולם לא על מה שהתקבל עכשיו ב-match_data (כבר לייב).
                    await _lock_prediction_snapshot(conn, match_uuid, existing_pred, match_data)
                # else: אין baseline לפני-משחק אמיתי (המשחק נראה לראשונה כבר לייב/גמור)
                # — לא ממציאים אחד מנתוני-לייב, פשוט מדלגים.
            else:
                await conn.execute("""
                    INSERT INTO match_predictions (
                        match_id,
                        prob_home_stats,  prob_away_stats,  prob_draw_stats,
                        prob_home_env,    prob_away_env,    prob_draw_env,
                        prob_home_human,  prob_away_human,  prob_draw_human,
                        final_prob_home,  final_prob_away,  final_prob_draw,
                        monte_carlo_home, monte_carlo_away, monte_carlo_draw,
                        simulations_run,  confidence_score,
                        key_factors,      calculated_at
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                        $11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20
                    )
                    ON CONFLICT (match_id) DO UPDATE
                        SET final_prob_home  = EXCLUDED.final_prob_home,
                            final_prob_away  = EXCLUDED.final_prob_away,
                            final_prob_draw  = EXCLUDED.final_prob_draw,
                            confidence_score = EXCLUDED.confidence_score,
                            key_factors      = EXCLUDED.key_factors,
                            calculated_at    = NOW()
                """,
                    match_uuid,
                    by_module.get("stats",       {}).get("home"),
                    by_module.get("stats",       {}).get("away"),
                    by_module.get("stats",       {}).get("draw"),
                    by_module.get("environment", {}).get("home"),
                    by_module.get("environment", {}).get("away"),
                    by_module.get("environment", {}).get("draw"),
                    by_module.get("human",       {}).get("home"),
                    by_module.get("human",       {}).get("away"),
                    by_module.get("human",       {}).get("draw"),
                    final.get("home"),
                    final.get("away"),
                    final.get("draw"),
                    mc.get("home"),
                    mc.get("away"),
                    mc.get("draw"),
                    mc.get("simulations", 10000),
                    prediction.get("confidence"),
                    json.dumps(prediction.get("key_factors", [])),
                    datetime.utcnow(),
                )

            # 3. Upsert יחסים — תמיד מעדכן אם כבר קיים (מונע שמירת יחסים ישנים).
            # ממשיך לעדכן גם אחרי נעילה — יחסי השוק הנוכחיים עדיין רלוונטיים כמידע.
            if odds and odds.get("odds_home"):
                home_vb = (value_bets.get("home") or {})
                draw_vb = (value_bets.get("draw") or {})
                away_vb = (value_bets.get("away") or {})
                is_vb   = bool(
                    home_vb.get("is_value_bet") or
                    draw_vb.get("is_value_bet") or
                    away_vb.get("is_value_bet")
                )
                existing_id = await conn.fetchval(
                    "SELECT id FROM bookmaker_odds WHERE match_id = $1 LIMIT 1",
                    match_uuid
                )
                if existing_id:
                    await conn.execute("""
                        UPDATE bookmaker_odds
                        SET odds_home    = $2,
                            odds_draw    = $3,
                            odds_away    = $4,
                            value_home   = $5,
                            value_draw   = $6,
                            value_away   = $7,
                            is_value_bet = $8
                        WHERE id = $1
                    """,
                        existing_id,
                        odds.get("odds_home"),
                        odds.get("odds_draw"),
                        odds.get("odds_away"),
                        home_vb.get("value"),
                        draw_vb.get("value"),
                        away_vb.get("value"),
                        is_vb,
                    )
                else:
                    await conn.execute("""
                        INSERT INTO bookmaker_odds (
                            match_id, bookmaker,
                            odds_home, odds_draw, odds_away,
                            implied_prob_home, implied_prob_draw, implied_prob_away,
                            value_home, value_draw, value_away,
                            is_value_bet
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                    """,
                        match_uuid,
                        odds.get("bookmaker", ""),
                        odds.get("odds_home"),
                        odds.get("odds_draw"),
                        odds.get("odds_away"),
                        odds.get("implied_prob_home"),
                        odds.get("implied_prob_draw"),
                        odds.get("implied_prob_away"),
                        home_vb.get("value"),
                        draw_vb.get("value"),
                        away_vb.get("value"),
                        is_vb,
                    )

        # odds snapshot for CLV tracking — fire-and-forget, non-blocking
        if odds and odds.get("odds_home"):
            try:
                pool2 = await get_db()
                if pool2:
                    await save_odds_snapshot(
                        pool2,
                        str(match_uuid),
                        float(odds.get("odds_home") or 0),
                        float(odds.get("odds_draw") or 0),
                        float(odds.get("odds_away") or 0),
                        bookmaker=odds.get("bookmaker", ""),
                        snapshot_type="scheduler",
                    )
            except Exception:
                pass

        logger.info(f"Saved prediction: {match_data.get('home_team')} vs {match_data.get('away_team')} | uuid={match_uuid}")
        return str(match_uuid)

    except Exception as e:
        import traceback
        global _last_save_error
        _last_save_error = f"{type(e).__name__}: {e} | {traceback.format_exc()[-500:]}"
        logger.error(f"save_match_prediction failed: {_last_save_error}")
        return None


async def _lock_prediction_snapshot(conn, match_uuid, existing_pred, match_data: dict) -> None:
    """
    קפיאה חד-פעמית של ההמלצה + ההסתברויות + מונטה קרלו + הימורי ערך, ברגע שהמשחק
    נצפה לראשונה כ-live/finished. הבנייה מתבססת אך ורק על existing_pred (המספרים
    האחרונים שנשמרו לפני המשחק) ועל יחסי bookmaker_odds הקיימים — לא על match_data
    של הקריאה הנוכחית, שכבר לייב. ה-UPDATE מותנה ב-locked_at IS NULL כדי להיות
    בטוח תחת קריאות מקבילות (scheduler + web) בלי טרנזקציה מפורשת.
    """
    from app.engine.prediction_model import get_recommendation, calculate_value

    final_snapshot = {
        "home": existing_pred["final_prob_home"],
        "draw": existing_pred["final_prob_draw"],
        "away": existing_pred["final_prob_away"],
    }
    mc_snapshot = {
        "home":        existing_pred["monte_carlo_home"],
        "draw":        existing_pred["monte_carlo_draw"],
        "away":        existing_pred["monte_carlo_away"],
        "simulations": existing_pred["simulations_run"],
    }

    existing_odds = await conn.fetchrow(
        "SELECT odds_home, odds_draw, odds_away FROM bookmaker_odds WHERE match_id = $1 LIMIT 1",
        match_uuid,
    )

    odds_snapshot = None
    value_bets_snapshot = {}
    if existing_odds and existing_odds["odds_home"]:
        odds_snapshot = {
            "home": existing_odds["odds_home"],
            "draw": existing_odds["odds_draw"],
            "away": existing_odds["odds_away"],
        }
        recommendation = get_recommendation(
            final_snapshot,
            match_data.get("home_team", ""),
            match_data.get("away_team", ""),
            bookmaker_odds=odds_snapshot,
        )
        for outcome in ("home", "draw", "away"):
            odd = odds_snapshot.get(outcome)
            prob = final_snapshot.get(outcome)
            if odd and prob is not None:
                vb = calculate_value(prob, odd)
                if vb["is_value_bet"]:
                    value_bets_snapshot[outcome] = vb
    else:
        recommendation = get_recommendation(
            final_snapshot,
            match_data.get("home_team", ""),
            match_data.get("away_team", ""),
        )

    snapshot = {
        "recommendation":    recommendation,
        "final":             final_snapshot,
        "monte_carlo":       mc_snapshot,
        "value_bets":        value_bets_snapshot,
        # consensus.master == prediction.final whenever there's no analyst
        # consensus for this match yet (the common case) — freeze in step.
        "consensus_master":  final_snapshot,
    }

    result = await conn.execute("""
        UPDATE match_predictions
        SET locked_snapshot = $2::jsonb,
            locked_odds     = $3::jsonb,
            locked_at       = NOW()
        WHERE match_id = $1 AND locked_at IS NULL
    """,
        match_uuid,
        json.dumps(snapshot),
        json.dumps(odds_snapshot) if odds_snapshot else None,
    )
    if result == "UPDATE 1":
        logger.info(f"Locked prediction snapshot for match {match_uuid}: {recommendation.get('recommendation')}")


async def get_locked_snapshots(fixture_ids: list) -> dict:
    """
    שליפה מרוכזת (query אחד) של locked_snapshot/locked_odds לכל ה-fixture_ids
    שכבר ננעלו. Keyed by fixture_id (api_football_id). לשימוש ב-serving path —
    כדי להחליף בתגובה מה שחושב מחדש (ואולי כבר סטה מהמשחק) בערך שקפא ברגע
    הנעילה. fixture_ids ריק/None מחזיר {} בלי לגעת ב-DB.
    """
    if not fixture_ids:
        return {}
    pool = await get_db()
    if pool is None:
        return {}
    try:
        rows = await pool.fetch("""
            SELECT m.api_football_id AS fixture_id,
                   mp.locked_snapshot, mp.locked_odds
            FROM matches m
            JOIN match_predictions mp ON mp.match_id = m.id
            WHERE m.api_football_id = ANY($1::int[])
              AND mp.locked_at IS NOT NULL
        """, list(fixture_ids))
        return {
            row["fixture_id"]: {
                "snapshot": _parse_jsonb(row["locked_snapshot"]),
                "odds":     _parse_jsonb(row["locked_odds"]),
            }
            for row in rows
        }
    except Exception as e:
        logger.error(f"get_locked_snapshots failed: {e}")
        return {}


def apply_locked_snapshot(result: dict, locked: Optional[dict]) -> None:
    """
    דורס את result במקום (in place) לפי locked snapshot, אם קיים —
    prediction.recommendation / prediction.final / prediction.monte_carlo /
    value_bets / consensus.master. לא נוגע בשדות live בלבד (score/elapsed/
    _status) ולא ביחסי השוק הנוכחיים (result["odds"]) — אלה ממשיכים להתעדכן
    כמידע חי, רק החיזוי/ההמלצה עצמם קפואים.
    """
    if not locked or not locked.get("snapshot"):
        return
    snap = locked["snapshot"]

    prediction = result.get("prediction")
    if isinstance(prediction, dict):
        if "recommendation" in snap:
            prediction["recommendation"] = snap["recommendation"]
        if "final" in snap:
            prediction["final"] = snap["final"]
        if "monte_carlo" in snap:
            prediction["monte_carlo"] = snap["monte_carlo"]

    if "value_bets" in snap:
        result["value_bets"] = snap["value_bets"]

    consensus = result.get("consensus")
    if isinstance(consensus, dict) and "consensus_master" in snap:
        consensus["master"] = snap["consensus_master"]


_last_save_error: Optional[str] = None


def get_last_save_error() -> Optional[str]:
    return _last_save_error


# ────────────────────────────────────────────────────────────────────────────
# Track Record
# ────────────────────────────────────────────────────────────────────────────

async def get_track_record(limit: int = 50) -> dict:
    """
    מחזיר סטטיסטיקות Track Record מה-DB.
    כולל:
    - ניבויים שנגמרו עם תוצאות (prediction_results)
    - ניבויים pending שעדיין לא נגמרו (match_predictions בלבד)
    """
    pool = await get_db()
    if pool is None:
        return _empty_track_record()

    try:
        async with pool.acquire() as conn:
            # סטטיסטיקה כללית — רק מניבויים שנגמרו.
            # predicted_outcome IS NULL = FILTERED_SYMMETRIC ("No Bet") — לא ניתנה
            # המלצה בכלל, אז לא נכלל במכנה של total (לא טעות, לא הצלחה).
            summary = await conn.fetchrow("""
                SELECT
                    COUNT(*) FILTER (WHERE pr.predicted_outcome IS NOT NULL)   AS total,
                    COUNT(*) FILTER (WHERE pr.was_correct)                     AS correct,
                    COUNT(*) FILTER (WHERE bo.is_value_bet)                    AS value_bets,
                    COUNT(*) FILTER (WHERE bo.is_value_bet AND pr.was_correct) AS vb_correct
                FROM prediction_results pr
                JOIN matches m ON m.id = pr.match_id
                LEFT JOIN bookmaker_odds bo ON bo.match_id = m.id
            """)

            # ניבויים שנגמרו עם תוצאות
            resolved = await conn.fetch("""
                SELECT
                    m.home_team_name,
                    m.away_team_name,
                    m.league_name,
                    m.match_date,
                    m.api_football_id  AS fixture_id,
                    pr.predicted_outcome,
                    pr.actual_outcome,
                    pr.was_correct,
                    pr.value_bet_hit,
                    bo.odds_home,
                    bo.odds_draw,
                    bo.odds_away,
                    mp.final_prob_home,
                    mp.final_prob_draw,
                    mp.final_prob_away,
                    mp.confidence_score,
                    mp.locked_snapshot,
                    mp.locked_at,
                    'finished'         AS status
                FROM prediction_results pr
                JOIN matches m ON m.id = pr.match_id
                LEFT JOIN match_predictions mp ON mp.match_id = m.id
                LEFT JOIN bookmaker_odds bo ON bo.match_id = m.id
                ORDER BY pr.archived_at DESC
                LIMIT $1
            """, limit // 2)

            # ניבויים pending — בנויים אבל עדיין לא נגמרו
            pending = await conn.fetch("""
                SELECT
                    m.home_team_name,
                    m.away_team_name,
                    m.league_name,
                    m.match_date,
                    m.api_football_id  AS fixture_id,
                    NULL::text         AS predicted_outcome,
                    NULL::text         AS actual_outcome,
                    NULL::boolean      AS was_correct,
                    FALSE              AS value_bet_hit,
                    bo.odds_home,
                    bo.odds_draw,
                    bo.odds_away,
                    mp.final_prob_home,
                    mp.final_prob_draw,
                    mp.final_prob_away,
                    mp.confidence_score,
                    mp.locked_snapshot,
                    mp.locked_at,
                    'pending'          AS status
                FROM match_predictions mp
                JOIN matches m ON m.id = mp.match_id
                LEFT JOIN prediction_results pr ON pr.match_id = m.id
                LEFT JOIN bookmaker_odds bo ON bo.match_id = m.id
                WHERE pr.match_id IS NULL
                ORDER BY mp.calculated_at DESC
                LIMIT $1
            """, limit // 2)

            total   = summary["total"]   or 0
            correct = summary["correct"] or 0
            vb      = summary["value_bets"] or 0
            vb_ok   = summary["vb_correct"] or 0

            # accuracy breakdown per league (mirrors calculateLeagueAccuracy JS)
            league_rows = await conn.fetch("""
                SELECT
                    m.league_name,
                    COUNT(*) FILTER (WHERE pr.predicted_outcome IS NOT NULL) AS total,
                    COUNT(*) FILTER (WHERE pr.was_correct)                  AS correct
                FROM prediction_results pr
                JOIN matches m ON m.id = pr.match_id
                GROUP BY m.league_name
                ORDER BY total DESC
            """)
            by_league = [
                {
                    "league": row["league_name"],
                    "total":   row["total"],
                    "correct": row["correct"],
                    "rate":    round(row["correct"] / row["total"] * 100, 1) if row["total"] else 0,
                }
                for row in league_rows
            ]

            # מיין: ניבויים שנגמרו קודם, אחר כך pending
            recent = [dict(r) for r in resolved] + [dict(r) for r in pending]
            for r in recent:
                r["locked_snapshot"] = _parse_jsonb(r.get("locked_snapshot"))

            return {
                "summary": {
                    "total":        total,
                    "correct":      correct,
                    "accuracy":     round(correct / total * 100, 1) if total else 0,
                    "value_bets":   vb,
                    "vb_correct":   vb_ok,
                    "vb_accuracy":  round(vb_ok / vb * 100, 1) if vb else 0,
                    "pending":      len(pending),
                },
                "by_league": by_league,
                "recent":    recent,
            }

    except Exception as e:
        logger.error(f"get_track_record failed: {e}")
        return _empty_track_record()


def _empty_track_record() -> dict:
    return {"summary": {"total": 0, "correct": 0, "accuracy": 0, "value_bets": 0, "vb_correct": 0, "vb_accuracy": 0}, "recent": []}


# ────────────────────────────────────────────────────────────────────────────
# Daily Results Recap
# ────────────────────────────────────────────────────────────────────────────

async def get_today_results_recap(tz_name: str = "Asia/Jerusalem") -> dict:
    """
    Returns today's resolved predictions for the Telegram daily recap.
    Filters by archived_at >= today midnight (Israel time).
    """
    from zoneinfo import ZoneInfo
    from datetime import date, time as dtime

    tz = ZoneInfo(tz_name)
    today_midnight = datetime.combine(datetime.now(tz).date(), dtime.min, tzinfo=tz)

    pool = await get_db()
    if pool is None:
        return _empty_recap()

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    m.home_team_name,
                    m.away_team_name,
                    m.league_name,
                    pr.predicted_outcome,
                    pr.actual_outcome,
                    pr.was_correct,
                    pr.value_bet_hit,
                    bo.is_value_bet,
                    CASE pr.predicted_outcome
                        WHEN 'home' THEN bo.odds_home
                        WHEN 'draw' THEN bo.odds_draw
                        WHEN 'away' THEN bo.odds_away
                    END AS predicted_odds
                FROM prediction_results pr
                JOIN matches m ON m.id = pr.match_id
                LEFT JOIN bookmaker_odds bo ON bo.match_id = m.id
                WHERE pr.archived_at >= $1
                ORDER BY pr.archived_at DESC
                LIMIT 30
            """, today_midnight)

        total    = len(rows)
        hits     = sum(1 for r in rows if r["was_correct"])
        vb_total = sum(1 for r in rows if r["is_value_bet"])
        vb_hits  = sum(1 for r in rows if r["value_bet_hit"])

        cumulative_odds = 1.0
        for r in rows:
            if r["was_correct"] and r["predicted_odds"] and float(r["predicted_odds"]) > 1:
                cumulative_odds *= float(r["predicted_odds"])
        if total == 0:
            cumulative_odds = 0.0

        _label = {"home": "1 (בית)", "draw": "X (תיקו)", "away": "2 (חוץ)"}
        match_lines: list[str] = []
        for r in rows:
            icon  = "✅" if r["was_correct"] else "❌"
            pred  = _label.get(r["predicted_outcome"] or "", r["predicted_outcome"] or "?")
            odds  = f" `{r['predicted_odds']:.2f}`" if r["predicted_odds"] else ""
            vb    = " ⚡" if r["is_value_bet"] else ""
            match_lines.append(
                f"{icon}{vb} {r['home_team_name']} — {r['away_team_name']} → *{pred}*{odds}"
            )

        return {
            "total":           total,
            "hits":            hits,
            "hit_rate":        round(hits / total * 100, 1) if total else 0.0,
            "cumulative_odds": round(cumulative_odds, 2),
            "vb_total":        vb_total,
            "vb_hits":         vb_hits,
            "match_lines":     match_lines[:15],
        }

    except Exception as e:
        logger.error(f"get_today_results_recap failed: {e}")
        return _empty_recap()


def _empty_recap() -> dict:
    return {
        "total": 0, "hits": 0, "hit_rate": 0.0,
        "cumulative_odds": 0.0, "vb_total": 0, "vb_hits": 0,
        "match_lines": [],
    }


# ────────────────────────────────────────────────────────────────────────────
# עדכון תוצאה אמיתית
# ────────────────────────────────────────────────────────────────────────────

# ────────────────────────────────────────────────────────────────────────────
# אנליסטים
# ────────────────────────────────────────────────────────────────────────────

async def create_analyst(name: str, expertise_league: str = "") -> Optional[str]:
    pool = await get_db()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            uid = await conn.fetchval(
                """INSERT INTO analysts (name, expertise_league)
                   VALUES ($1, $2) RETURNING id""",
                name, expertise_league
            )
            return str(uid) if uid else None
    except Exception as e:
        logger.error(f"create_analyst failed: {e}")
        return None


async def list_analysts() -> list:
    pool = await get_db()
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, name, expertise_league, win_rate,
                          total_predictions, correct_predictions, created_at
                   FROM analysts ORDER BY win_rate DESC, total_predictions DESC"""
            )
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"list_analysts failed: {e}")
        return []


async def get_match_uuid_by_fixture(fixture_id: int) -> Optional[str]:
    pool = await get_db()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            uid = await conn.fetchval(
                "SELECT id FROM matches WHERE api_football_id = $1", fixture_id
            )
            return str(uid) if uid else None
    except Exception as e:
        logger.error(f"get_match_uuid_by_fixture failed: {e}")
        return None


async def submit_analyst_prediction(
    fixture_id: int, analyst_id: str, outcome: str,
    confidence: int, reasoning: str = ""
) -> bool:
    pool = await get_db()
    if pool is None:
        return False
    try:
        async with pool.acquire() as conn:
            match_uuid = await conn.fetchval(
                "SELECT id FROM matches WHERE api_football_id = $1", fixture_id
            )
            if not match_uuid:
                return False

            await conn.execute(
                """INSERT INTO analyst_predictions
                       (match_id, analyst_id, predicted_outcome, confidence_level, reasoning)
                   VALUES ($1, $2::uuid, $3, $4, $5)
                   ON CONFLICT DO NOTHING""",
                match_uuid, analyst_id, outcome, confidence, reasoning
            )

            await conn.execute(
                """UPDATE analysts
                   SET total_predictions = total_predictions + 1
                   WHERE id = $1::uuid""",
                analyst_id
            )
            return True
    except Exception as e:
        logger.error(f"submit_analyst_prediction failed: {e}")
        return False


async def get_match_analyst_predictions(fixture_id: int) -> list:
    pool = await get_db()
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT ap.predicted_outcome, ap.confidence_level, ap.reasoning, ap.submitted_at,
                          a.id as analyst_id, a.name, a.win_rate
                   FROM analyst_predictions ap
                   JOIN analysts a ON a.id = ap.analyst_id
                   JOIN matches m ON m.id = ap.match_id
                   WHERE m.api_football_id = $1
                   ORDER BY ap.submitted_at DESC""",
                fixture_id
            )
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"get_match_analyst_predictions failed: {e}")
        return []


async def get_analyst_predictions_history(analyst_id: str, limit: int = 20) -> list:
    pool = await get_db()
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT ap.predicted_outcome, ap.confidence_level, ap.submitted_at,
                          m.home_team_name, m.away_team_name, m.league_name, m.match_date,
                          m.api_football_id as fixture_id,
                          pr.was_correct, pr.actual_outcome
                   FROM analyst_predictions ap
                   JOIN matches m ON m.id = ap.match_id
                   LEFT JOIN prediction_results pr ON pr.match_id = m.id
                   WHERE ap.analyst_id = $1::uuid
                   ORDER BY ap.submitted_at DESC LIMIT $2""",
                analyst_id, limit
            )
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"get_analyst_predictions_history failed: {e}")
        return []


async def get_consensus_locks(limit: int = 10) -> list:
    """
    נעילות קונסנזוס אמיתיות: משחקים שטרם הוכרעו שבהם רוב האנליסטים
    שסימנו ניבוי מסכימים עם תוצאת האלגוריתם.
    """
    pool = await get_db()
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    m.api_football_id AS fixture_id,
                    m.home_team_name, m.away_team_name, m.league_name, m.match_date,
                    mp.final_prob_home, mp.final_prob_draw, mp.final_prob_away,
                    bo.odds_home, bo.odds_draw, bo.odds_away,
                    ARRAY_AGG(ap.predicted_outcome) AS analyst_picks
                FROM analyst_predictions ap
                JOIN matches m  ON m.id = ap.match_id
                LEFT JOIN match_predictions mp  ON mp.match_id = m.id
                LEFT JOIN prediction_results pr ON pr.match_id = m.id
                LEFT JOIN bookmaker_odds bo     ON bo.match_id = m.id
                WHERE pr.match_id IS NULL
                GROUP BY m.api_football_id, m.home_team_name, m.away_team_name,
                         m.league_name, m.match_date,
                         mp.final_prob_home, mp.final_prob_draw, mp.final_prob_away,
                         bo.odds_home, bo.odds_draw, bo.odds_away
                ORDER BY MAX(ap.submitted_at) DESC
                LIMIT $1
            """, limit)

        locks = []
        for r in rows:
            probs = {
                "home": r["final_prob_home"] or 0,
                "draw": r["final_prob_draw"] or 0,
                "away": r["final_prob_away"] or 0,
            }
            if not any(probs.values()):
                continue
            algo_pick = max(probs, key=probs.get)
            picks     = [p for p in (r["analyst_picks"] or []) if p]
            agreeing  = sum(1 for p in picks if p == algo_pick)
            # נעילה = רוב האנליסטים מסכימים עם האלגוריתם
            if not picks or agreeing * 2 <= len(picks):
                continue
            odds_key = {"home": "odds_home", "draw": "odds_draw", "away": "odds_away"}[algo_pick]
            locks.append({
                "fixture_id":      r["fixture_id"],
                "home_team":       r["home_team_name"],
                "away_team":       r["away_team_name"],
                "league":          r["league_name"],
                "match_date":      r["match_date"].isoformat() if r["match_date"] else None,
                "algo_pick":       algo_pick,
                "algo_prob":       round(probs[algo_pick], 4),
                "agreeing_count":  agreeing,
                "total_analysts":  len(picks),
                "market_odds":     r[odds_key],
            })
        return locks
    except Exception as e:
        logger.error(f"get_consensus_locks failed: {e}")
        return []


async def update_match_result(fixture_id: int, home_score: int, away_score: int) -> bool:
    """
    כשמשחק מסתיים — שמור את התוצאה האמיתית וחשב האם הניבוי היה נכון.
    actual_outcome: 'home' | 'draw' | 'away'
    """
    pool = await get_db()
    if pool is None:
        return False

    try:
        if home_score > away_score:
            actual = "home"
        elif away_score > home_score:
            actual = "away"
        else:
            actual = "draw"

        async with pool.acquire() as conn:
            # מצא את המשחק
            row = await conn.fetchrow("""
                SELECT m.id, mp.final_prob_home, mp.final_prob_draw, mp.final_prob_away,
                       mp.locked_snapshot
                FROM matches m
                LEFT JOIN match_predictions mp ON mp.match_id = m.id
                WHERE m.api_football_id = $1
            """, fixture_id)

            if not row:
                return False

            match_uuid = row["id"]
            locked     = _parse_jsonb(row["locked_snapshot"])

            if locked and locked.get("recommendation"):
                # דרך תקנית — נגד ה-recommendation שקפא ברגע הנעילה, לא נגד
                # highest-probability גולמי (מתעלם מ-Double Chance / No Bet).
                rec    = locked["recommendation"]
                status = rec.get("status")
                if status in ("APPROVED", "DRAW_VALUE"):
                    predicted_outcome = rec.get("outcome")
                    was_correct       = (predicted_outcome == actual)
                elif status == "DOUBLE_CHANCE":
                    hedge             = rec.get("hedge_outcomes") or []
                    predicted_outcome = "1X" if "home" in hedge else "X2"
                    was_correct       = actual in hedge
                elif status == "FILTERED_SYMMETRIC":
                    # לא ניתנה המלצה — לא סופר לטובה/רעה, רק נשמר לתיעוד.
                    predicted_outcome = None
                    was_correct       = None
                else:
                    predicted_outcome = rec.get("outcome")
                    was_correct       = (predicted_outcome == actual) if predicted_outcome else None
                value_bets_locked = locked.get("value_bets") or {}
                vb_hit = bool(was_correct) and predicted_outcome in value_bets_locked
            else:
                # שורה legacy — נוצרה לפני התיקון הזה, או משחק שנצפה לראשונה כבר
                # לייב/גמור (אין baseline לפני-משחק לקפוא עליו). ה-fallback הישן:
                # highest-probability גולמי מתוך final_prob_*.
                probs = {
                    "home": row["final_prob_home"] or 0,
                    "draw": row["final_prob_draw"] or 0,
                    "away": row["final_prob_away"] or 0,
                }
                predicted_outcome = max(probs, key=probs.get)
                was_correct       = (predicted_outcome == actual)
                vb_row = await conn.fetchrow(
                    "SELECT is_value_bet FROM bookmaker_odds WHERE match_id = $1 LIMIT 1",
                    match_uuid
                )
                vb_hit = bool(vb_row and vb_row["is_value_bet"] and was_correct)

            # upsert תוצאה
            await conn.execute("""
                INSERT INTO prediction_results (
                    match_id, predicted_outcome, actual_outcome,
                    was_correct, algorithm_was_correct, value_bet_hit
                ) VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (match_id) DO UPDATE
                    SET actual_outcome       = EXCLUDED.actual_outcome,
                        was_correct          = EXCLUDED.was_correct,
                        algorithm_was_correct = EXCLUDED.algorithm_was_correct,
                        value_bet_hit        = EXCLUDED.value_bet_hit,
                        archived_at          = NOW()
            """, match_uuid, predicted_outcome, actual, was_correct, was_correct, vb_hit)

            # עדכן סטטוס ותוצאה ב-matches — אטומי: רק אם עדיין לא 'finished'.
            # זה מה שמונע ניקוד כפול של אנליסטים — לפני התיקון, save_match_prediction
            # היה מאפס בטעות את הסטטוס בחזרה ל-'scheduled' אחרי שכבר סומן 'finished',
            # מה שגרם למשחק הזה להיבחר שוב ע"י auto_results ולהיספר פעמיים.
            newly_finished = await conn.fetchval("""
                UPDATE matches
                SET status = 'finished', home_score = $2, away_score = $3
                WHERE id = $1 AND status != 'finished'
                RETURNING id
            """, match_uuid, home_score, away_score)

            # ── ניקוד אנליסטים אמיתי — פעם אחת בלבד למשחק (idempotent) ──
            # total_predictions כבר נספר בהזנה; כאן מעדכנים correct_predictions
            # ומחשבים מחדש win_rate = דיוק אמיתי (correct/total).
            if newly_finished is not None:
                scored = await conn.execute("""
                    UPDATE analysts a SET
                        correct_predictions = a.correct_predictions + sub.correct_count,
                        win_rate = CASE WHEN a.total_predictions > 0
                            THEN ROUND((a.correct_predictions + sub.correct_count)::numeric
                                       / a.total_predictions, 4)
                            ELSE a.win_rate END
                    FROM (
                        SELECT analyst_id,
                               COUNT(*) FILTER (WHERE predicted_outcome = $2) AS correct_count
                        FROM analyst_predictions
                        WHERE match_id = $1
                        GROUP BY analyst_id
                    ) sub
                    WHERE a.id = sub.analyst_id
                """, match_uuid, actual)
                logger.info(f"Analyst scoring: {scored} (fixture={fixture_id}, actual={actual})")

        logger.info(f"Result saved: fixture={fixture_id} | predicted={predicted_outcome} actual={actual} correct={was_correct}")
        return True

    except Exception as e:
        logger.error(f"update_match_result failed: {e}")
        return False


# ────────────────────────────────────────────────────────────────────────────
# Odds Snapshot (CLV prep)
# ────────────────────────────────────────────────────────────────────────────

async def save_odds_snapshot(
    pool,
    match_uuid: str,
    odds_home: float,
    odds_draw: float,
    odds_away: float,
    bookmaker: str = "",
    snapshot_type: str = "live",
) -> None:
    """
    Appends a timestamped odds snapshot to bookmaker_line_history.
    Used for CLV (Closing Line Value) tracking.
    Table is created on first call if it does not exist.
    """
    try:
        async with pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS bookmaker_line_history (
                    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    match_id    UUID REFERENCES matches(id),
                    bookmaker   VARCHAR(50),
                    odds_home   FLOAT,
                    odds_draw   FLOAT,
                    odds_away   FLOAT,
                    snapshot_type VARCHAR(20) DEFAULT 'live',
                    recorded_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            await conn.execute("""
                INSERT INTO bookmaker_line_history
                    (match_id, bookmaker, odds_home, odds_draw, odds_away, snapshot_type)
                VALUES ($1::uuid, $2, $3, $4, $5, $6)
            """, match_uuid, bookmaker, odds_home, odds_draw, odds_away, snapshot_type)
    except Exception as e:
        logger.debug(f"save_odds_snapshot failed for {match_uuid}: {e}")


# ────────────────────────────────────────────────────────────────────────────
# OLBG Auto-Consensus
# ────────────────────────────────────────────────────────────────────────────

async def get_match_uuid(pool, fixture_id: int) -> Optional[str]:
    """Convert API-Football integer fixture ID to internal match UUID."""
    try:
        async with pool.acquire() as conn:
            result = await conn.fetchval(
                "SELECT id FROM matches WHERE api_football_id = $1",
                int(fixture_id),
            )
            return str(result) if result else None
    except Exception as e:
        logger.error(f"get_match_uuid failed for fixture {fixture_id}: {e}")
        return None


async def inject_auto_consensus_predictions(
    pool, match_uuid: str, league_name: str, consensus_probs: dict
) -> list:
    """
    Distributes OLBG consensus percentages across 10 fixed auto-analysts in DB.
    Feeds real expert consensus into calculate_consensus() to produce genuine LOCKs.
    """
    if not consensus_probs:
        return []

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                analyst_ids = []
                for i in range(1, 11):
                    analyst_name = f"Auto_Expert_{i}_{league_name.replace(' ', '_')}"
                    analyst_id = await conn.fetchval("""
                        INSERT INTO analysts (name, expertise_league, win_rate)
                        VALUES ($1, $2, 0.55)
                        ON CONFLICT (name) DO UPDATE SET expertise_league = $2
                        RETURNING id
                    """, analyst_name, league_name)
                    if not analyst_id:
                        analyst_id = await conn.fetchval(
                            "SELECT id FROM analysts WHERE name = $1", analyst_name
                        )
                    analyst_ids.append(analyst_id)

                # distribute 10 slots by percentage
                outcomes: list = []
                for outcome, prob in consensus_probs.items():
                    outcomes.extend([outcome] * round(prob * 10))
                while len(outcomes) < 10:
                    outcomes.append(max(consensus_probs, key=consensus_probs.get))
                while len(outcomes) > 10:
                    minority = min(consensus_probs, key=consensus_probs.get)
                    idx = len(outcomes) - 1 - outcomes[::-1].index(minority)
                    outcomes.pop(idx)

                inserted = []
                for idx, analyst_id in enumerate(analyst_ids):
                    outcome = outcomes[idx]
                    await conn.execute("""
                        DELETE FROM analyst_predictions
                        WHERE match_id = $1::uuid AND analyst_id = $2
                    """, match_uuid, analyst_id)
                    await conn.execute("""
                        INSERT INTO analyst_predictions
                            (match_id, analyst_id, predicted_outcome, confidence_level, reasoning)
                        VALUES ($1::uuid, $2, $3, $4, $5)
                    """, match_uuid, analyst_id, outcome, 7, "Generated via Auto-Consensus Stream")
                    inserted.append({
                        "analyst_id": str(analyst_id),
                        "outcome":    outcome,
                        "confidence": 7,
                        "win_rate":   0.55,
                    })
                return inserted
    except Exception as e:
        logger.error(f"inject_auto_consensus_predictions failed for {match_uuid}: {e}")
        return []


async def get_match_analyst_predictions_by_uuid(pool, match_uuid: str) -> list:
    """Fetch analyst predictions by match UUID (returns keys expected by calculate_consensus)."""
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    ap.predicted_outcome AS outcome,
                    ap.confidence_level  AS confidence,
                    a.win_rate
                FROM analyst_predictions ap
                JOIN analysts a ON a.id = ap.analyst_id
                WHERE ap.match_id = $1::uuid
            """, match_uuid)
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"get_match_analyst_predictions_by_uuid failed for {match_uuid}: {e}")
        return []


async def get_todays_fixtures(pool) -> list:
    """
    Fetch today's active fixtures for OLBG enrichment job.
    "Today" means Israel's calendar day, not the DB session's default (UTC) —
    otherwise a late-evening Israel match could fall on the wrong side of the
    cutoff near midnight.
    """
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    api_football_id  AS id,
                    home_team_name   AS home_team,
                    away_team_name   AS away_team,
                    league_name,
                    status
                FROM matches
                WHERE (match_date AT TIME ZONE 'Asia/Jerusalem')::date
                    = (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
                  AND status IN ('scheduled', 'live', '1H', '2H', 'HT', 'ET')
                ORDER BY match_date
            """)
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"get_todays_fixtures failed: {e}")
        return []


async def get_pre_match_matrix(pool, match_uuid: str) -> Optional[dict]:
    """Fetch pre-match matrix snapshot."""
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchval(
                "SELECT pre_match_matrix FROM match_predictions WHERE match_id = $1::uuid",
                match_uuid,
            )
        if not row:
            return None
        if isinstance(row, str):
            return json.loads(row)
        return row
    except Exception as e:
        logger.error(f"get_pre_match_matrix failed for {match_uuid}: {e}")
        return None


async def update_match_halftime_matrix(pool, match_uuid: str, matrix: dict) -> None:
    """Save halftime recalculated matrix. Writes once — skips if already set."""
    try:
        async with pool.acquire() as conn:
            await conn.execute("""
                UPDATE match_predictions
                   SET halftime_matrix = $2
                 WHERE match_id = $1::uuid
                   AND halftime_matrix IS NULL
            """, match_uuid, json.dumps(matrix))
    except Exception as e:
        logger.error(f"update_match_halftime_matrix failed for {match_uuid}: {e}")


async def get_complete_match_data(pool, match_uuid: str) -> Optional[dict]:
    """
    Single-query fetch of all prediction data for a match.
    Computes consensus on-the-fly from DB analyst predictions.
    Returns consistent shape whether analysts exist or not.
    """
    from app.engine.prediction_model import calculate_consensus

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT
                    final_prob_home, final_prob_draw, final_prob_away,
                    pre_match_matrix, halftime_matrix,
                    confidence_score
                FROM match_predictions
                WHERE match_id = $1::uuid
            """, match_uuid)

        if not row:
            return None

        analyst_preds = await get_match_analyst_predictions_by_uuid(pool, match_uuid)
        final_probs = {
            "home": float(row["final_prob_home"] or 0),
            "draw": float(row["final_prob_draw"] or 0),
            "away": float(row["final_prob_away"] or 0),
        }

        def _parse(field):
            if field is None:           return None
            if isinstance(field, str):  return json.loads(field)
            if isinstance(field, dict): return field
            if isinstance(field, (bytes, bytearray)): return json.loads(field.decode())
            return field

        return {
            "final_probs":      final_probs,
            "pre_match_matrix": _parse(row["pre_match_matrix"]),
            "halftime_matrix":  _parse(row["halftime_matrix"]),
            "consensus_cached": calculate_consensus(final_probs, analyst_preds),
            "confidence":       float(row["confidence_score"]) if row["confidence_score"] else None,
        }

    except Exception as e:
        logger.error(f"get_complete_match_data failed for {match_uuid}: {e}")
        return None
