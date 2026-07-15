-- ============================================================
-- 360SCOUT — Full Database Schema
-- Run: psql -U postgres -d scout360 -f 001_init.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== TEAMS =====
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    country_code CHAR(3),
    api_football_id INTEGER UNIQUE,
    altitude_adaptation FLOAT DEFAULT 0.0,
    heat_adaptation FLOAT DEFAULT 0.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== MATCHES =====
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

-- ===== TEAM FORM & STATS =====
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

-- ===== HEAD TO HEAD =====
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

-- ===== ENVIRONMENT =====
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

-- ===== REFEREES =====
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

-- ===== INJURIES =====
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

-- ===== PSYCHOLOGY =====
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

-- ===== PREDICTIONS =====
CREATE TABLE IF NOT EXISTS match_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    prob_home_stats FLOAT,
    prob_away_stats FLOAT,
    prob_draw_stats FLOAT,
    prob_home_env FLOAT,
    prob_away_env FLOAT,
    prob_draw_env FLOAT,
    prob_home_human FLOAT,
    prob_away_human FLOAT,
    prob_draw_human FLOAT,
    final_prob_home FLOAT,
    final_prob_away FLOAT,
    final_prob_draw FLOAT,
    monte_carlo_home FLOAT,
    monte_carlo_away FLOAT,
    monte_carlo_draw FLOAT,
    simulations_run INTEGER DEFAULT 10000,
    confidence_score FLOAT,
    edge_score FLOAT,
    key_factors JSONB DEFAULT '[]',
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== ODDS =====
CREATE TABLE IF NOT EXISTS bookmaker_odds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id),
    bookmaker VARCHAR(50),
    odds_home FLOAT,
    odds_draw FLOAT,
    odds_away FLOAT,
    implied_prob_home FLOAT,
    implied_prob_draw FLOAT,
    implied_prob_away FLOAT,
    value_home FLOAT,
    value_draw FLOAT,
    value_away FLOAT,
    is_value_bet BOOLEAN DEFAULT FALSE,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== ANALYSTS =====
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

-- ===== CONSENSUS =====
CREATE TABLE IF NOT EXISTS consensus_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    analyst_consensus_home FLOAT,
    analyst_consensus_away FLOAT,
    analyst_consensus_draw FLOAT,
    agreement_type VARCHAR(30) DEFAULT 'ALGORITHM_ONLY',
    master_score_home FLOAT,
    master_score_away FLOAT,
    master_score_draw FLOAT,
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== TRACK RECORD =====
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

-- ===== AUTH =====
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

CREATE TABLE IF NOT EXISTS sessions (
    token        VARCHAR(64) PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
);

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league_id);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON match_predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_match ON bookmaker_odds(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_value ON bookmaker_odds(is_value_bet) WHERE is_value_bet = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Done!
SELECT 'Schema created successfully' AS status;
