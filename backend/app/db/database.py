"""
360SCOUT — Database Layer
Async connection pool via asyncpg (ללא SQLAlchemy ORM — שאילתות SQL ישירות).
"""

import os
import logging
import asyncpg
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Pool singleton ──────────────────────────────────────────────────────────
_pool: asyncpg.Pool | None = None
_last_error: str | None = None


def get_last_error() -> str | None:
    return _last_error


def dsn_scheme() -> str:
    """החזר רק את ה-scheme של ה-DSN (לדיבוג, ללא חשיפת סיסמה)"""
    raw = os.getenv("DATABASE_URL", "")
    return raw.split("://", 1)[0] if "://" in raw else "(empty)"


def _build_dsn() -> str:
    """המר DATABASE_URL לפורמט asyncpg תקין"""
    url = os.getenv("DATABASE_URL", "")
    # SQLAlchemy format → asyncpg
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    # Railway / Heroku משתמשים ב-"postgres://" — asyncpg צריך "postgresql://"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url


MIGRATION_SQL = """
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    country_code CHAR(3),
    api_football_id INTEGER UNIQUE,
    altitude_adaptation FLOAT DEFAULT 0.0,
    heat_adaptation FLOAT DEFAULT 0.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_football_id INTEGER UNIQUE,
    home_team_id UUID REFERENCES teams(id),
    away_team_id UUID REFERENCES teams(id),
    home_team_name VARCHAR(100),
    away_team_name VARCHAR(100),
    league_name VARCHAR(100),
    league_id INTEGER,
    match_date TIMESTAMPTZ,
    venue VARCHAR(200),
    city VARCHAR(100),
    status VARCHAR(20) DEFAULT 'scheduled',
    home_score INTEGER,
    away_score INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_form (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID REFERENCES teams(id),
    match_id UUID REFERENCES matches(id),
    xg_for FLOAT DEFAULT 0,
    xg_against FLOAT DEFAULT 0,
    possession FLOAT DEFAULT 50,
    shots_on_target INTEGER DEFAULT 0,
    ppda FLOAT DEFAULT 0,
    form_score FLOAT DEFAULT 0,
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS head_to_head (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_a_id UUID REFERENCES teams(id),
    team_b_id UUID REFERENCES teams(id),
    matches_played INTEGER DEFAULT 0,
    team_a_wins INTEGER DEFAULT 0,
    team_b_wins INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    avg_goals_total FLOAT DEFAULT 0,
    psychological_edge FLOAT DEFAULT 0,
    UNIQUE(team_a_id, team_b_id)
);

CREATE TABLE IF NOT EXISTS match_environment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    temperature_celsius FLOAT,
    humidity_percent FLOAT,
    wind_speed_kmh FLOAT,
    precipitation_mm FLOAT DEFAULT 0,
    altitude_meters INTEGER DEFAULT 0,
    weather_condition VARCHAR(50),
    home_weather_advantage FLOAT DEFAULT 0,
    away_weather_advantage FLOAT DEFAULT 0,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    nationality VARCHAR(50),
    api_football_id INTEGER UNIQUE,
    avg_yellow_cards FLOAT DEFAULT 3.5,
    avg_red_cards FLOAT DEFAULT 0.2,
    avg_fouls_called FLOAT DEFAULT 25,
    penalty_rate FLOAT DEFAULT 0.15,
    home_bias_score FLOAT DEFAULT 0,
    big_match_experience INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS match_referee (
    match_id UUID REFERENCES matches(id),
    referee_id UUID REFERENCES referees(id),
    PRIMARY KEY (match_id, referee_id)
);

CREATE TABLE IF NOT EXISTS injuries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id),
    team_id UUID REFERENCES teams(id),
    player_name VARCHAR(100),
    position VARCHAR(20),
    impact_weight FLOAT DEFAULT 0.3,
    confirmed_out BOOLEAN DEFAULT FALSE,
    reported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_psychology (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    crowd_size INTEGER DEFAULT 0,
    venue_type VARCHAR(20) DEFAULT 'neutral',
    tournament_stage VARCHAR(50) DEFAULT 'group',
    pressure_index FLOAT DEFAULT 0.5,
    rest_days_home INTEGER DEFAULT 7,
    rest_days_away INTEGER DEFAULT 7,
    travel_km_away INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS match_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    prob_home_stats FLOAT, prob_away_stats FLOAT, prob_draw_stats FLOAT,
    prob_home_env FLOAT,   prob_away_env FLOAT,   prob_draw_env FLOAT,
    prob_home_human FLOAT, prob_away_human FLOAT, prob_draw_human FLOAT,
    final_prob_home FLOAT, final_prob_away FLOAT, final_prob_draw FLOAT,
    monte_carlo_home FLOAT, monte_carlo_away FLOAT, monte_carlo_draw FLOAT,
    simulations_run INTEGER DEFAULT 10000,
    confidence_score FLOAT,
    edge_score FLOAT,
    key_factors JSONB DEFAULT '[]',
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookmaker_odds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id),
    bookmaker VARCHAR(50),
    odds_home FLOAT, odds_draw FLOAT, odds_away FLOAT,
    implied_prob_home FLOAT, implied_prob_draw FLOAT, implied_prob_away FLOAT,
    value_home FLOAT, value_draw FLOAT, value_away FLOAT,
    is_value_bet BOOLEAN DEFAULT FALSE,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    expertise_league VARCHAR(100),
    win_rate FLOAT DEFAULT 0.50,
    total_predictions INTEGER DEFAULT 0,
    correct_predictions INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analyst_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id),
    analyst_id UUID REFERENCES analysts(id),
    predicted_outcome VARCHAR(10),
    confidence_level INTEGER CHECK (confidence_level BETWEEN 1 AND 10),
    reasoning TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consensus_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    analyst_consensus_home FLOAT, analyst_consensus_away FLOAT, analyst_consensus_draw FLOAT,
    agreement_type VARCHAR(30) DEFAULT 'ALGORITHM_ONLY',
    master_score_home FLOAT, master_score_away FLOAT, master_score_draw FLOAT,
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prediction_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    predicted_outcome VARCHAR(10),
    actual_outcome VARCHAR(10),
    was_correct BOOLEAN,
    algorithm_was_correct BOOLEAN,
    value_bet_hit BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Backported from database/migrations/002_add_matrix_columns.sql + 003 ──────
-- These were applied by hand to production but never reflected here, so a
-- fresh database bootstrapped from this file alone was missing them.
ALTER TABLE match_predictions
    ADD COLUMN IF NOT EXISTS pre_match_matrix  JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS halftime_matrix   JSONB DEFAULT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'analysts_name_unique'
    ) THEN
        ALTER TABLE analysts ADD CONSTRAINT analysts_name_unique UNIQUE (name);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'analyst_predictions_match_analyst_unique'
    ) THEN
        ALTER TABLE analyst_predictions
            ADD CONSTRAINT analyst_predictions_match_analyst_unique
            UNIQUE (match_id, analyst_id);
    END IF;
END
$$;

-- ── 004: Locked prediction snapshot — frozen at kickoff, never overwritten ────
ALTER TABLE match_predictions
    ADD COLUMN IF NOT EXISTS locked_snapshot JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS locked_odds     JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS locked_at       TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_date   ON matches(match_date);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league_id);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON match_predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_match ON bookmaker_odds(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_value ON bookmaker_odds(is_value_bet) WHERE is_value_bet = TRUE;

CREATE TABLE IF NOT EXISTS api_cache (
    key        VARCHAR(255) PRIMARY KEY,
    cache_type VARCHAR(50),
    data       TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON api_cache(expires_at);

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'user'    CHECK (role IN ('user', 'admin')),
    status        VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by   UUID REFERENCES users(id),
    approved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
    token        VARCHAR(64) PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
"""


async def init_db() -> None:
    """אתחל את ה-connection pool וריצת migration — נקרא מ-startup של FastAPI"""
    global _pool
    global _last_error
    if _pool is not None:
        return
    dsn = _build_dsn()
    if not dsn:
        _last_error = "DATABASE_URL is empty"
        logger.error(_last_error)
        return
    try:
        _pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=1,
            max_size=10,
            command_timeout=60,
        )
        logger.info("DB pool initialized")
        async with _pool.acquire() as conn:
            # Extension may already exist — ignore duplicate-key error
            try:
                await conn.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
            except Exception:
                pass
            # Tables all use IF NOT EXISTS — safe to run on every startup
            tables_sql = MIGRATION_SQL.replace('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";', '')
            await conn.execute(tables_sql)
            logger.info("DB migration complete")
        _last_error = None
    except Exception as e:
        _last_error = f"{type(e).__name__}: {e}"
        logger.error(f"DB init failed: {_last_error}")
        _pool = None


async def close_db() -> None:
    """סגור את ה-pool — נקרא מ-shutdown של FastAPI"""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("DB pool closed")


async def get_db() -> asyncpg.Pool | None:
    """החזר את ה-pool (None אם חיבור נכשל — האפליקציה ממשיכה ללא DB)"""
    if _pool is None:
        await init_db()
    return _pool
