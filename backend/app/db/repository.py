"""
360SCOUT — Repository Layer
פונקציות לשמירה וקריאה של ניבויים מ-PostgreSQL.
כל פונקציה עובדת ב-graceful degradation — אם DB לא זמין, לא קורסת.
"""

import json
import logging
from datetime import datetime
from typing import Optional

from .database import get_db

logger = logging.getLogger(__name__)


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

        # parse תאריך
        match_date = None
        date_str = match_data.get("match_date", "")
        if date_str:
            try:
                match_date = datetime.strptime(date_str, "%d/%m/%Y %H:%M")
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
                        match_date     = EXCLUDED.match_date,
                        status         = EXCLUDED.status
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

            # 2. Upsert לטבלת match_predictions
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

            # 3. Upsert יחסים (אם יש)
            if odds and odds.get("odds_home"):
                # בדוק אם כבר יש odds למשחק הזה
                existing = await conn.fetchval(
                    "SELECT id FROM bookmaker_odds WHERE match_id = $1 LIMIT 1",
                    match_uuid
                )
                if not existing:
                    home_vb = (value_bets.get("home") or {})
                    draw_vb = (value_bets.get("draw") or {})
                    away_vb = (value_bets.get("away") or {})
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
                        bool(home_vb.get("is_value_bet") or draw_vb.get("is_value_bet") or away_vb.get("is_value_bet")),
                    )

        logger.info(f"Saved prediction: {match_data.get('home_team')} vs {match_data.get('away_team')} | uuid={match_uuid}")
        return str(match_uuid)

    except Exception as e:
        import traceback
        global _last_save_error
        _last_save_error = f"{type(e).__name__}: {e} | {traceback.format_exc()[-500:]}"
        logger.error(f"save_match_prediction failed: {_last_save_error}")
        return None


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
            # סטטיסטיקה כללית — רק מניבויים שנגמרו
            summary = await conn.fetchrow("""
                SELECT
                    COUNT(*)                                                    AS total,
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
                    COUNT(*)                                   AS total,
                    COUNT(*) FILTER (WHERE pr.was_correct)    AS correct
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
                SELECT m.id, mp.final_prob_home, mp.final_prob_draw, mp.final_prob_away
                FROM matches m
                LEFT JOIN match_predictions mp ON mp.match_id = m.id
                WHERE m.api_football_id = $1
            """, fixture_id)

            if not row:
                return False

            match_uuid = row["id"]

            # קבע prediction — הסתברות הגבוהה ביותר
            probs = {
                "home": row["final_prob_home"] or 0,
                "draw": row["final_prob_draw"] or 0,
                "away": row["final_prob_away"] or 0,
            }
            predicted = max(probs, key=probs.get)
            was_correct = (predicted == actual)

            # בדוק value bet
            vb_hit = False
            vb_row = await conn.fetchrow(
                "SELECT is_value_bet FROM bookmaker_odds WHERE match_id = $1 LIMIT 1",
                match_uuid
            )
            if vb_row and vb_row["is_value_bet"]:
                vb_hit = was_correct

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
            """, match_uuid, predicted, actual, was_correct, was_correct, vb_hit)

            # עדכן סטטוס ותוצאה ב-matches
            await conn.execute("""
                UPDATE matches
                SET status = 'finished', home_score = $2, away_score = $3
                WHERE id = $1
            """, match_uuid, home_score, away_score)

        logger.info(f"Result saved: fixture={fixture_id} | predicted={predicted} actual={actual} correct={was_correct}")
        return True

    except Exception as e:
        logger.error(f"update_match_result failed: {e}")
        return False
