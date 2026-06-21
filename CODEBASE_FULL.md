# 360SCOUT / ANALYST365 — Full Codebase Reference
**Generated: 2026-06-17**

---

## System Overview

360SCOUT is a 360-degree football prediction platform deployed at **analyst365.net**.

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, asyncpg, APScheduler |
| Database | PostgreSQL (Railway) |
| Frontend | Next.js (App Router), TypeScript, Tailwind |
| External APIs | API-Football (v3), The Odds API (v4), OpenWeather |
| Notifications | Telegram Bot (polling) |
| Deployment | Railway (backend), Vercel (frontend) |

### Core Formula — The Winning Method (LOCKED, tag: winning-method-v1, commit 368b897)
```
edge = (probability × decimal_odds − 1) × 100
is_value_bet when edge_percent > 5%
```

### xG Calibration (Option B — Totals-based)
```
S = 1/H + 1/D + 1/A              # 3-way vig removal
P_fair = (1/odds) / S             # vig-free probability
xg_total = Poisson_inversion(P_under_fair)  # from O/U 2.5
xg_home, xg_away = xg_total × split by ratio
```

### Module Weights
```
Stats (xG/form/H2H): 40%
Environment (weather/altitude): 20%
Human factors (referee/injuries): 25%
Psychology (crowd/stage/fatigue): 15%
```

---

## Directory Tree

```
360scout/
├── backend/
│   ├── main.py                           # FastAPI entry point
│   └── app/
│       ├── api/routes/
│       │   ├── live.py                   # Main pipeline: fixtures, analysis, value bets (1324 lines)
│       │   ├── matches.py                # predict, value-bet, consensus, cross-check, demo
│       │   ├── analysts.py               # Analyst CRUD + prediction submission
│       │   └── signals.py                # Signals endpoint (Cloud Function format)
│       ├── engine/
│       │   ├── prediction_model.py       # Poisson PMF, PredictionEngine, calculate_value
│       │   ├── goals_engine.py           # GoalsValueSignal, adjust_xg, calculate_goals_value
│       │   ├── dynamic_adjuster.py       # AdjustmentParams, adjust_probabilities
│       │   ├── kelly.py                  # Kelly Criterion (Quarter-Kelly, 5% cap)
│       │   └── live_filter.py            # Ghost Signal, Edge min, Logic Mismatch, Anti-Contradiction
│       ├── db/
│       │   ├── database.py               # asyncpg pool, MIGRATION_SQL (15 tables)
│       │   └── repository.py             # save_match_prediction (UPSERT), get_track_record, analysts
│       ├── tasks/
│       │   ├── olbg_scraper.py           # Playwright OLBG expert consensus scraper
│       │   ├── data_fetcher.py           # Legacy pipeline runner
│       │   └── analyst365_client.py      # Analyst365 API client + HTML monitor
│       ├── cache.py                      # File + DB dual cache, TTL_MAP
│       ├── scheduler.py                  # APScheduler: fetch_live (5min), auto_results (60min)
│       ├── telegram_bot.py               # send_value_bet_alert, send_live_value_alert, dedup set
│       └── telegram_commands.py          # /signals, /live, /track, /locks — polling loop
├── frontend/
│   ├── app/
│   │   └── page.tsx                      # Main SSR page: getLiveMatches, getTrackStats
│   ├── components/
│   │   ├── MatchCard.tsx                 # Full match card: odds table, modules, consensus, goals
│   │   ├── MatchLiveRow.tsx              # Live in-play row: clock, EdgePill, value alert
│   │   ├── LiveInPlayTab.tsx             # Live tab: header, empty state, MatchLiveRow list
│   │   ├── DashboardTabs.tsx             # All / Live / World Cup tab switcher
│   │   └── LeagueFilteredMatches.tsx     # (not shown — renders MatchCard per league)
│   ├── hooks/
│   │   ├── useLiveClock.ts               # Client-side minute ticker with server snap
│   │   └── useLivePolling.ts             # Adaptive polling: 20s/35s/90s/180s, drift detection
│   ├── lib/
│   │   ├── valueBets.ts                  # bestValueBet, maxEdge selectors
│   │   └── enhancedMatches.ts            # Odds fallback from The Odds API
│   └── utils/
│       └── analytics.ts                  # calculateValueBets, marketOddsFromValueBets
└── database/
    └── migrations/
        └── 001_init.sql                  # Full PostgreSQL schema (15 tables + indexes)
```

---

## Backend

---

### `backend/main.py`

```python
"""
360SCOUT — FastAPI Application Entry Point
Run: python main.py  (or: uvicorn main:app --reload)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.matches import router as matches_router
from app.api.routes.live import router as live_router
from app.api.routes.analysts import router as analysts_router
from app.api.routes.signals import router as signals_router
from app.telegram_bot import test_bot, send_message, ENABLED as TELEGRAM_ENABLED
from app.db.database import init_db, close_db
from app.scheduler import start_scheduler, stop_scheduler
from app.telegram_commands import start_command_bot, stop_command_bot


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    start_scheduler()
    start_command_bot()
    yield
    stop_command_bot()
    stop_scheduler()
    await close_db()


app = FastAPI(
    title       = "360SCOUT — Sports Prediction API",
    description = "360-Degree cross-referencing predictive model for football.",
    version     = "1.0.0",
    lifespan    = lifespan,
)

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://analyst365.net",
    "https://www.analyst365.net",
    "https://360scout.vercel.app",
    os.getenv("FRONTEND_URL", ""),
    os.getenv("VERCEL_URL", ""),
]
ALLOWED_ORIGINS = [o for o in ALLOWED_ORIGINS if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ALLOWED_ORIGINS,
    allow_origin_regex= r"https://.*\.vercel\.app",
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

app.include_router(matches_router)
app.include_router(live_router)
app.include_router(analysts_router)
app.include_router(signals_router)


@app.get("/")
async def root():
    return {"name": "360SCOUT API", "version": "1.0.0", "status": "running"}

@app.get("/health")
async def health():
    from app.scheduler import _scheduler
    jobs = []
    if _scheduler:
        jobs = [{"id": j.id, "next_run": str(j.next_run_time)} for j in _scheduler.get_jobs()]
    return {"status": "ok", "scheduler": "running" if _scheduler else "off", "jobs": jobs}

@app.get("/api/telegram/test")
async def telegram_test():
    return await test_bot()

@app.post("/api/telegram/send")
async def telegram_send(message: str):
    ok = await send_message(message)
    return {"sent": ok, "telegram_enabled": TELEGRAM_ENABLED}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    reload = os.getenv("APP_ENV", "development") == "development"
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
```

---

### `backend/app/engine/prediction_model.py`

```python
"""
360SCOUT — Core Prediction Engine
Layers: Stats → Environment → Human Factors → Psychology → Monte Carlo
"""

import math
import numpy as np
from dataclasses import dataclass, field
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# ── Precomputed factorials for Poisson PMF (range(16) covers max_goals <= 15)
_FACT = np.array([math.factorial(k) for k in range(16)], dtype=float)


def poisson_match_probabilities(xg_home: float, xg_away: float, max_goals: int = 8) -> dict:
    """
    Converts xG to 1/X/2 probabilities via Poisson matrix.
    matrix[h][a] = P(home=h, away=a). Home win = below diagonal, away = above, draw = diagonal.
    Normalized to 1 to compensate for tail truncation at max_goals.
    """
    lh = max(float(xg_home), 0.05)
    la = max(float(xg_away), 0.05)
    ks = np.arange(max_goals + 1)
    fact = _FACT[:max_goals + 1] if max_goals < len(_FACT) else np.array(
        [math.factorial(k) for k in ks], dtype=float
    )
    home_pmf = np.exp(-lh) * lh ** ks / fact
    away_pmf = np.exp(-la) * la ** ks / fact
    matrix = np.outer(home_pmf, away_pmf)

    home = float(np.tril(matrix, -1).sum())
    away = float(np.triu(matrix,  1).sum())
    draw = float(np.trace(matrix))
    total = home + draw + away or 1.0
    return {"home": home / total, "draw": draw / total, "away": away / total}


def poisson_goal_markets(xg_home: float, xg_away: float, line: float = 2.5, max_goals: int = 10) -> dict:
    """Goal markets (Over/Under + BTTS) from same Poisson matrix."""
    lh = max(float(xg_home), 0.05)
    la = max(float(xg_away), 0.05)
    ks = np.arange(max_goals + 1)
    fact = _FACT[:max_goals + 1] if max_goals < len(_FACT) else np.array(
        [math.factorial(k) for k in ks], dtype=float
    )
    home_pmf = np.exp(-lh) * lh ** ks / fact
    away_pmf = np.exp(-la) * la ** ks / fact
    matrix = np.outer(home_pmf, away_pmf)
    total = float(matrix.sum()) or 1.0

    goal_sum = ks[:, None] + ks[None, :]
    over  = float(matrix[goal_sum > line].sum()) / total
    under = max(0.0, 1.0 - over)
    btts_yes = float(matrix[1:, 1:].sum()) / total
    btts_no  = max(0.0, 1.0 - btts_yes)

    return {
        "line": line, "over": round(over, 4), "under": round(under, 4),
        "btts_yes": round(btts_yes, 4), "btts_no": round(btts_no, 4),
    }


@dataclass
class MatchContext:
    """All inputs for a full 360° prediction"""
    xg_home: float = 1.3
    xg_away: float = 1.1
    form_home: float = 0.0
    form_away: float = 0.0
    h2h_advantage: float = 0.0
    possession_home: float = 50.0
    temperature: float = 20.0
    humidity: float = 50.0
    precipitation_mm: float = 0.0
    altitude_meters: int = 0
    home_heat_adaptation: float = 0.5
    away_heat_adaptation: float = 0.5
    referee_cards_per_game: float = 3.5
    referee_home_bias: float = 0.0
    referee_penalty_rate: float = 0.15
    home_injury_impact: float = 0.0
    away_injury_impact: float = 0.0
    crowd_size: int = 40000
    venue_type: str = "neutral"
    tournament_stage: str = "group"
    pressure_index: float = 0.5
    rest_days_home: int = 7
    rest_days_away: int = 7
    travel_km_away: int = 0
    match_id: Optional[str] = None
    home_team: str = "Home Team"
    away_team: str = "Away Team"


class PredictionEngine:
    """360-Degree Cross-Referencing Predictive Model."""

    MODULE_WEIGHTS = {"stats": 0.40, "environment": 0.20, "human": 0.25, "psychology": 0.15}

    def predict(self, ctx: MatchContext) -> dict:
        stats  = self._stats_module(ctx)
        env    = self._environment_module(ctx)
        human  = self._human_factors_module(ctx)
        psych  = self._psychology_module(ctx)

        w = self.MODULE_WEIGHTS
        raw_home = stats["home"]*w["stats"] + env["home"]*w["environment"] + human["home"]*w["human"] + psych["home"]*w["psychology"]
        raw_away = stats["away"]*w["stats"] + env["away"]*w["environment"] + human["away"]*w["human"] + psych["away"]*w["psychology"]

        final = self._to_three_way(raw_home, raw_away, ctx)
        mc    = self._monte_carlo(final, n=10000)
        conf  = self._confidence(stats, env, human, psych, final, mc, ctx)

        return {
            "match_id": ctx.match_id, "home_team": ctx.home_team, "away_team": ctx.away_team,
            "final": {k: round(v, 4) for k, v in final.items()},
            "by_module": {"stats": stats, "environment": env, "human": human, "psychology": psych},
            "monte_carlo": {**{k: round(v, 4) for k, v in mc.items()}, "simulations": 10000},
            "confidence": round(conf, 1),
            "key_factors": self._key_factors(ctx),
        }

    def _stats_module(self, ctx):
        p = poisson_match_probabilities(ctx.xg_home, ctx.xg_away)
        home = p["home"] + ctx.form_home * 0.15 + ctx.h2h_advantage * 0.08
        away = p["away"] + ctx.form_away * 0.15 - ctx.h2h_advantage * 0.08
        draw = p["draw"]
        home = max(home, 0.02); away = max(away, 0.02)
        total = home + draw + away
        return {"home": round(home/total, 4), "draw": round(draw/total, 4), "away": round(away/total, 4)}

    def _environment_module(self, ctx):
        h = a = 0.50
        if ctx.precipitation_mm > 5:
            penalty = min(ctx.precipitation_mm / 50, 0.12)
            h += penalty * 0.3; a -= penalty * 0.3
        if ctx.temperature > 28 and ctx.humidity > 70:
            stress = (ctx.temperature-28)*0.01 + (ctx.humidity-70)*0.005
            delta = (ctx.home_heat_adaptation - ctx.away_heat_adaptation) * stress
            h += delta; a -= delta
        if ctx.altitude_meters > 2000:
            alt_factor = (ctx.altitude_meters - 2000) / 1000 * 0.08
            h += alt_factor * 0.6; a -= alt_factor * 0.4
        return self._normalize_two(h, a)

    def _human_factors_module(self, ctx):
        h = a = 0.50
        if ctx.referee_cards_per_game > 4:
            penalty = (ctx.referee_cards_per_game - 4) * 0.02
            a -= penalty; h += penalty * 0.5
        h += ctx.referee_home_bias * 0.05; a -= ctx.referee_home_bias * 0.05
        h -= ctx.home_injury_impact * 0.30; a -= ctx.away_injury_impact * 0.30
        return self._normalize_two(h, a)

    def _psychology_module(self, ctx):
        h = a = 0.50
        if ctx.venue_type == "home":
            h += min(ctx.crowd_size / 10_000 * 0.015, 0.10)
        elif ctx.venue_type == "away":
            a += min(ctx.crowd_size / 10_000 * 0.010, 0.07)
        stage_map = {"group_dead_rubber":-0.03, "group_must_win":0.03, "group":0.00, "knockout":0.05, "final":0.07}
        h += stage_map.get(ctx.tournament_stage, 0) * ctx.pressure_index
        rest_diff = ctx.rest_days_home - ctx.rest_days_away
        fatigue = np.clip(rest_diff * 0.02, -0.08, 0.08)
        h += fatigue; a -= fatigue
        if ctx.travel_km_away > 5000:
            a -= min((ctx.travel_km_away - 5000) / 10_000, 0.05)
        return self._normalize_two(h, a)

    def _monte_carlo(self, base_probs: dict, n: int = 10_000) -> dict:
        """Vectorized 10k simulations via numpy — NOT per-row random.choice."""
        p       = np.array([base_probs["home"], base_probs["draw"], base_probs["away"]])
        noise   = np.random.normal(0, 0.04, (n, 3))
        samples = np.clip(p + noise, 0.01, 0.98)
        samples /= samples.sum(axis=1, keepdims=True)
        cumsum  = samples.cumsum(axis=1)
        u       = np.random.uniform(size=(n, 1))
        winners = (u > cumsum).sum(axis=1)
        counts  = np.bincount(winners, minlength=3)
        total   = float(counts.sum())
        return {"home": counts[0]/total, "draw": counts[1]/total, "away": counts[2]/total}

    def _confidence(self, *args) -> float:
        """
        4 factors:
        1. Dominance (40%) — max prob vs 33% baseline
        2. Gap (30%) — gap between #1 and #2
        3. MC convergence (20%) — MC agrees with final
        4. Data richness (10%) — H2H/form/injuries/weather
        Range: 20%–90%
        """
        *modules_plus, ctx = args
        *modules, final, mc = modules_plus
        max_p = max(final["home"], final["draw"], final["away"])
        dominance_score = min((max_p - 0.333) / 0.667 * 1.5, 1.0)
        probs_sorted = sorted([final["home"], final["draw"], final["away"]], reverse=True)
        gap_score = min((probs_sorted[0] - probs_sorted[1]) / 0.22, 1.0)
        final_winner = max(final, key=final.get)
        mc_winner    = max(mc,    key=lambda k: mc[k] if k != "simulations" else 0)
        mc_agree     = 1.0 if final_winner == mc_winner else 0.3
        mc_score     = mc_agree * min(mc.get(final_winner, 0) * 2.0, 1.0)
        data_score   = 0.0
        if ctx is not None:
            if ctx.h2h_advantage != 0.0:            data_score += 0.30
            if ctx.form_home != 0.0:                data_score += 0.20
            if ctx.home_injury_impact != 0.0 or ctx.away_injury_impact != 0.0: data_score += 0.25
            if ctx.temperature != 20.0:             data_score += 0.15
            if ctx.referee_home_bias != 0.0:        data_score += 0.10
        combined = 0.40*dominance_score + 0.30*gap_score + 0.20*mc_score + 0.10*min(data_score,1.0)
        return round(max(20.0, min(90.0, combined * 70 + 20)), 1)

    def _key_factors(self, ctx):
        factors = []
        if ctx.precipitation_mm > 10:
            factors.append({"factor": "HEAVY_RAIN", "impact": "HIGH", "detail": f"{ctx.precipitation_mm}mm"})
        if ctx.temperature > 30 and ctx.humidity > 70:
            factors.append({"factor": "EXTREME_HEAT", "impact": "HIGH", "detail": f"{ctx.temperature}°C"})
        if ctx.altitude_meters > 2000:
            factors.append({"factor": "HIGH_ALTITUDE", "impact": "HIGH", "detail": f"{ctx.altitude_meters}m"})
        if ctx.home_injury_impact > 0.5:
            factors.append({"factor": "HOME_KEY_INJURY", "impact": "CRITICAL", "detail": f"{ctx.home_injury_impact:.0%}"})
        if ctx.away_injury_impact > 0.5:
            factors.append({"factor": "AWAY_KEY_INJURY", "impact": "CRITICAL", "detail": f"{ctx.away_injury_impact:.0%}"})
        if ctx.referee_cards_per_game > 5:
            factors.append({"factor": "STRICT_REFEREE", "impact": "HIGH", "detail": f"{ctx.referee_cards_per_game:.1f} cards/game"})
        if ctx.tournament_stage in ["knockout", "final"]:
            factors.append({"factor": "ELIMINATION_PRESSURE", "impact": "MEDIUM", "detail": ctx.tournament_stage})
        if ctx.travel_km_away > 8000:
            factors.append({"factor": "LONG_TRAVEL", "impact": "MEDIUM", "detail": f"{ctx.travel_km_away:,}km"})
        return factors

    def _normalize_two(self, home: float, away: float) -> dict:
        h = float(np.clip(home, 0.05, 0.80))
        a = float(np.clip(away, 0.05, 0.80))
        total = h + a
        if total > 0.85: h = h/total*0.85; a = a/total*0.85
        d = 1.0 - h - a
        return {"home": round(h, 4), "draw": round(max(d, 0.05), 4), "away": round(a, 4)}

    def _to_three_way(self, raw_home, raw_away, ctx=None) -> dict:
        xg_home = ctx.xg_home if ctx else 1.3
        xg_away = ctx.xg_away if ctx else 1.1
        xg_diff = abs(xg_home - xg_away)
        base_draw = max(0.14, 0.30 - xg_diff * 0.07)
        if ctx and ctx.tournament_stage in ("knockout", "final"): base_draw *= 0.60
        if ctx and ctx.pressure_index > 0.7: base_draw *= 0.85
        remaining = 1.0 - base_draw
        h = float(np.clip(raw_home, 0.01, 0.99))
        a = float(np.clip(raw_away, 0.01, 0.99))
        total_raw = h + a
        if total_raw > 0:
            home = remaining * h / total_raw; away = remaining * a / total_raw
        else:
            home = away = remaining / 2
        total = home + base_draw + away
        return {"home": round(home/total, 4), "draw": round(base_draw/total, 4), "away": round(away/total, 4)}


# ── Value Bet Calculator ──────────────────────────────────────────────────────

_NO_VALUE = {"value": 0, "edge_percent": 0, "is_value_bet": False, "rating": "NONE"}
_MAX_VALID_EDGE = 1.0
_UNDERDOG_PROB_CAP = 0.40
_MARKET_DIVERGENCE_RATIO = 0.60

def calculate_value(our_prob: float, bookmaker_odds: float) -> dict:
    if bookmaker_odds <= 1.0: return _NO_VALUE
    if our_prob > 1.0: our_prob /= 100.0
    implied_prob = 1 / bookmaker_odds
    value = (our_prob * bookmaker_odds) - 1
    if value > _MAX_VALID_EDGE: return _NO_VALUE
    edge_percent = value * 100
    market_divergence = implied_prob / our_prob
    is_suspicious = our_prob < _UNDERDOG_PROB_CAP and market_divergence < _MARKET_DIVERGENCE_RATIO
    rating = "NONE"
    if not is_suspicious:
        if value >= 0.25:    rating = "STRONG"
        elif value >= 0.15:  rating = "MODERATE"
        elif value >= 0.05:  rating = "WEAK"
    return {
        "value": round(value, 4), "edge_percent": round(edge_percent, 2),
        "is_value_bet": value > 0.05 and not is_suspicious, "is_suspicious": is_suspicious,
        "rating": rating, "our_prob": round(our_prob, 4), "implied_prob": round(implied_prob, 4),
        "market_divergence": round(market_divergence, 3), "bookmaker_odds": bookmaker_odds,
    }


# ── Over/Under 2.5 Edge (live-aware Poisson PMF) ─────────────────────────────

import math as _math

def calculate_under_over_25_edge(expected_goals, bookie_under_odds, bookie_over_odds,
                                  current_minutes=0, current_goals=0):
    if bookie_under_odds <= 1.0 or bookie_over_odds <= 1.0: return None
    time_remaining = (90 - current_minutes) / 90
    if time_remaining <= 0: return None
    if current_goals >= 3:
        return {
            "expected_goals": round(expected_goals, 2), "true_under_prob": 0.0, "true_over_prob": 100.0,
            "under_edge": round((-1)*100, 2), "over_edge": round((bookie_over_odds-1)*100, 2),
            "under_rating": "NONE", "over_rating": _ou_rating((bookie_over_odds-1)*100),
            "bookie_under_odds": bookie_under_odds, "bookie_over_odds": bookie_over_odds,
        }
    lambda_remaining = expected_goals * time_remaining
    max_future = 2 - current_goals
    true_under_prob = sum(
        _math.exp(-lambda_remaining) * (lambda_remaining**k) / _math.factorial(k)
        for k in range(max_future + 1)
    )
    true_over_prob = 1.0 - true_under_prob
    under_edge = (true_under_prob * bookie_under_odds - 1) * 100
    over_edge  = (true_over_prob  * bookie_over_odds  - 1) * 100
    return {
        "expected_goals": round(expected_goals, 2),
        "true_under_prob": round(true_under_prob * 100, 2),
        "true_over_prob":  round(true_over_prob  * 100, 2),
        "under_edge": round(under_edge, 2), "over_edge": round(over_edge, 2),
        "under_rating": _ou_rating(under_edge), "over_rating": _ou_rating(over_edge),
        "bookie_under_odds": bookie_under_odds, "bookie_over_odds": bookie_over_odds,
    }

def _ou_rating(edge_pct):
    if edge_pct >= 25.0: return "STRONG"
    if edge_pct >= 15.0: return "MODERATE"
    if edge_pct >= 5.0:  return "WEAK"
    return "NONE"


# ── Consensus Engine ──────────────────────────────────────────────────────────

def calculate_consensus(algorithm_probs: dict, analyst_predictions: list) -> dict:
    if not analyst_predictions:
        return {"type": "ALGORITHM_ONLY", "algorithm": algorithm_probs, "analysts": None,
                "master": algorithm_probs, "algo_edge": 0}
    votes = {"home": 0.0, "away": 0.0, "draw": 0.0}
    total_weight = 0.0
    for pred in analyst_predictions:
        weight = pred.get("win_rate", 0.5) * pred.get("confidence", 5)
        votes[pred["outcome"]] += weight; total_weight += weight
    if total_weight > 0:
        analyst = {k: v/total_weight for k, v in votes.items()}
    else:
        analyst = {"home": 1/3, "away": 1/3, "draw": 1/3}
    algo_winner    = max(algorithm_probs, key=algorithm_probs.get)
    analyst_winner = max(analyst, key=analyst.get)
    if algo_winner == analyst_winner:
        agreement = "LOCK"
    else:
        algo_edge  = algorithm_probs.get(algo_winner, 0) - analyst.get(algo_winner, 0)
        agreement  = "ALGORITHM_EDGE" if algo_edge > 0.15 else "DIVERGENCE"
    algo_edge_val = algorithm_probs.get(algo_winner, 0) - analyst.get(algo_winner, 0)
    master = {k: round(algorithm_probs[k]*0.60 + analyst[k]*0.40, 4) for k in ["home","away","draw"]}
    return {"type": agreement, "algorithm": algorithm_probs,
            "analysts": {k: round(v,4) for k,v in analyst.items()},
            "master": master, "algo_edge": round(algo_edge_val, 3)}
```

---

### `backend/app/engine/goals_engine.py`

```python
"""
360SCOUT — Goals Market Engine (Over/Under Poisson with dynamic xG adjustment)
Uses scipy.stats.poisson for numerical stability.
"""

from __future__ import annotations
import dataclasses, logging
from dataclasses import dataclass
from typing import Literal
import numpy as np
from scipy.stats import poisson

logger = logging.getLogger(__name__)

@dataclass
class XgModifiers:
    precipitation_mm: float = 0.0    # mm/h
    temperature_c:    float = 20.0   # °C
    home_gk_injured: bool = False
    away_gk_injured: bool = False
    home_key_defender_injured: bool = False
    away_key_defender_injured: bool = False
    home_striker_injured: bool = False
    away_striker_injured: bool = False

# Effect magnitudes (calibrated from published studies)
_RAIN_HEAVY_FACTOR   = 0.90   # >5 mm/h  → ×0.90
_RAIN_SEVERE_FACTOR  = 0.84   # >10 mm/h → ×0.84
_COLD_FACTOR         = 0.93   # <3 °C    → ×0.93
_HEAT_FACTOR         = 0.91   # >35 °C   → ×0.91
_GK_MISSING_BOOST        = 0.25
_KEY_DEF_MISSING_BOOST   = 0.15
_STRIKER_MISSING_PENALTY = 0.20
_XG_FLOOR = 0.30

@dataclass(frozen=True)
class AdjustedXg:
    xg_home_base: float; xg_away_base: float
    xg_home: float; xg_away: float
    delta_home: float; delta_away: float
    modifiers_applied: tuple

def adjust_xg(xg_home, xg_away, mods=None) -> AdjustedXg:
    """Order: 1-Weather multiplicative, 2-GK/defender additive boost to opponent, 3-striker penalty, 4-floor"""
    if mods is None: mods = XgModifiers()
    applied = []
    h = float(xg_home); a = float(xg_away)
    if mods.precipitation_mm > 10:  h *= _RAIN_SEVERE_FACTOR; a *= _RAIN_SEVERE_FACTOR; applied.append("rain_severe")
    elif mods.precipitation_mm > 5: h *= _RAIN_HEAVY_FACTOR;  a *= _RAIN_HEAVY_FACTOR;  applied.append("rain_heavy")
    if mods.temperature_c < 3:      h *= _COLD_FACTOR; a *= _COLD_FACTOR; applied.append("extreme_cold")
    elif mods.temperature_c > 35:   h *= _HEAT_FACTOR; a *= _HEAT_FACTOR; applied.append("extreme_heat")
    if mods.home_gk_injured:              a += _GK_MISSING_BOOST;        applied.append("home_gk_out")
    if mods.away_gk_injured:              h += _GK_MISSING_BOOST;        applied.append("away_gk_out")
    if mods.home_key_defender_injured:    a += _KEY_DEF_MISSING_BOOST;   applied.append("home_key_def_out")
    if mods.away_key_defender_injured:    h += _KEY_DEF_MISSING_BOOST;   applied.append("away_key_def_out")
    if mods.home_striker_injured:         h -= _STRIKER_MISSING_PENALTY; applied.append("home_striker_out")
    if mods.away_striker_injured:         a -= _STRIKER_MISSING_PENALTY; applied.append("away_striker_out")
    h = max(_XG_FLOOR, h); a = max(_XG_FLOOR, a)
    return AdjustedXg(round(float(xg_home),3), round(float(xg_away),3), round(h,3), round(a,3),
                      round(h-float(xg_home),3), round(a-float(xg_away),3), tuple(applied))

@dataclass(frozen=True)
class GoalsValueSignal:
    line: float
    xg_home: float; xg_away: float; expected_total: float
    over_prob: float; under_prob: float; btts_yes_prob: float; btts_no_prob: float
    over_odds: float; under_odds: float
    over_edge: float; under_edge: float
    over_rating: str; under_rating: str
    signal: Literal["OVER", "UNDER", "NO_SIGNAL"]
    signal_edge: float; signal_rating: str
    modifiers_applied: tuple

    def to_dict(self) -> dict:
        d = dataclasses.asdict(self); d["modifiers_applied"] = list(d["modifiers_applied"]); return d

def _ou_rating(edge_pct):
    if edge_pct >= 25.0: return "STRONG"
    if edge_pct >= 15.0: return "MODERATE"
    if edge_pct >= 5.0:  return "WEAK"
    return "NONE"

def _poisson_matrix(lh, la, max_goals=10):
    ks = np.arange(max_goals + 1)
    matrix = np.outer(poisson.pmf(ks, lh), poisson.pmf(ks, la))
    total = float(matrix.sum()) or 1.0
    return matrix / total

def calculate_goals_value(xg_home, xg_away, over_odds, under_odds, line=2.5, mods=None, max_goals=10):
    if over_odds <= 1.0 or under_odds <= 1.0: return None
    if xg_home <= 0 or xg_away <= 0: return None
    axg = adjust_xg(xg_home, xg_away, mods)
    lh = max(axg.xg_home, 0.05); la = max(axg.xg_away, 0.05)
    matrix = _poisson_matrix(lh, la, max_goals)
    ks = np.arange(max_goals + 1)
    goal_sum = ks[:, None] + ks[None, :]
    over_prob  = float(matrix[goal_sum > line].sum())
    under_prob = max(0.0, 1.0 - over_prob)
    btts_yes   = float(matrix[1:, 1:].sum())
    over_edge  = (over_prob  * over_odds  - 1) * 100
    under_edge = (under_prob * under_odds - 1) * 100
    best_name, best_edge = max([("OVER", over_edge), ("UNDER", under_edge)], key=lambda x: x[1])
    signal       = best_name if best_edge >= 5.0 else "NO_SIGNAL"
    signal_edge  = round(best_edge, 2) if signal != "NO_SIGNAL" else 0.0
    return GoalsValueSignal(
        line=line, xg_home=axg.xg_home, xg_away=axg.xg_away, expected_total=round(lh+la,2),
        over_prob=round(over_prob,4), under_prob=round(under_prob,4),
        btts_yes_prob=round(btts_yes,4), btts_no_prob=round(max(0,1-btts_yes),4),
        over_odds=over_odds, under_odds=under_odds,
        over_edge=round(over_edge,2), under_edge=round(under_edge,2),
        over_rating=_ou_rating(over_edge), under_rating=_ou_rating(under_edge),
        signal=signal, signal_edge=signal_edge, signal_rating=_ou_rating(best_edge),
        modifiers_applied=axg.modifiers_applied,
    )

def injury_flags_from_list(injuries, home_team_id, away_team_id, weather=None):
    """Convert API-Football /injuries + OpenWeather to XgModifiers."""
    w = weather or {}
    prec = float(w.get("precipitation_mm", 0.0)); temp = float(w.get("temperature_celsius", 20.0))
    home_inj = [i for i in (injuries or []) if i.get("team",{}).get("id") == home_team_id]
    away_inj = [i for i in (injuries or []) if i.get("team",{}).get("id") == away_team_id]
    def _classify(team_inj):
        flags = {"gk": False, "def": False, "str": False}
        for inj in team_inj:
            pos = (inj.get("player",{}).get("position") or "").strip().lower()
            if pos == "goalkeeper": flags["gk"] = True
            elif pos == "defender": flags["def"] = True
            elif pos in {"attacker","forward"}: flags["str"] = True
        return flags
    hf = _classify(home_inj); af = _classify(away_inj)
    return XgModifiers(
        precipitation_mm=prec, temperature_c=temp,
        home_gk_injured=hf["gk"], away_gk_injured=af["gk"],
        home_key_defender_injured=hf["def"], away_key_defender_injured=af["def"],
        home_striker_injured=hf["str"], away_striker_injured=af["str"],
    )
```

---

### `backend/app/engine/dynamic_adjuster.py`

```python
"""
360SCOUT — Dynamic Probability Adjuster
Adjusts base probabilities by: Motivation (±6%), Sentiment (±4%), Rotation (−7%).
"""

from __future__ import annotations
from dataclasses import dataclass

@dataclass
class AdjustmentParams:
    home_motivation: float = 0.5   # [0,1] — >0.5 = critical match
    away_motivation: float = 0.5
    home_sentiment:  float = 0.0   # [-1,1]
    away_sentiment:  float = 0.0
    home_rotation:   bool  = False
    away_rotation:   bool  = False

_MOTIVATION_WEIGHT = 0.06
_SENTIMENT_WEIGHT  = 0.04
_ROTATION_PENALTY  = 0.07

def adjust_probabilities(base_probs: dict, params: AdjustmentParams | None = None, **kwargs) -> dict:
    if params is None:
        params = AdjustmentParams(
            home_motivation = kwargs.get("home_motivation", 0.5),
            away_motivation = kwargs.get("away_motivation", 0.5),
            home_sentiment  = kwargs.get("home_sentiment",  0.0),
            away_sentiment  = kwargs.get("away_sentiment",  0.0),
            home_rotation   = kwargs.get("home_rotation",   False),
            away_rotation   = kwargs.get("away_rotation",   False),
        )
    home = base_probs.get("home", 0.33)
    draw = base_probs.get("draw", 0.33)
    away = base_probs.get("away", 0.33)
    motivation_delta = (params.home_motivation - params.away_motivation) * _MOTIVATION_WEIGHT
    home += motivation_delta; away -= motivation_delta
    home += params.home_sentiment * _SENTIMENT_WEIGHT
    away += params.away_sentiment * _SENTIMENT_WEIGHT
    if params.home_rotation: home -= _ROTATION_PENALTY; draw += _ROTATION_PENALTY * 0.5
    if params.away_rotation: away -= _ROTATION_PENALTY; draw += _ROTATION_PENALTY * 0.5
    home = max(0.03, min(0.92, home)); draw = max(0.03, min(0.92, draw)); away = max(0.03, min(0.92, away))
    total = home + draw + away
    return {"home": round(home/total,4), "draw": round(draw/total,4), "away": round(away/total,4)}
```

---

### `backend/app/engine/kelly.py`

```python
"""
360SCOUT — Kelly Criterion Risk Manager
f* = (b×p − q) / b   where b = odds−1, q = 1−p
Uses Quarter-Kelly (×0.25) with 5% bankroll cap.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Literal

@dataclass(frozen=True)
class KellyResult:
    our_prob: float; bookie_odds: float
    full_kelly: float; quarter_kelly: float; bet_size: float; bankroll: float
    edge_pct: float; verdict: Literal["BET", "SKIP"]; reason: str

_QUARTER = 0.25
_MAX_BET_PCT = 0.05

def kelly_criterion(bankroll, our_prob, bookie_odds, fraction=_QUARTER, max_pct=_MAX_BET_PCT) -> KellyResult:
    if bankroll <= 0:      return _no_bet(bankroll, our_prob, bookie_odds, "Bankroll must be > 0")
    if not (0 < our_prob < 1): return _no_bet(bankroll, our_prob, bookie_odds, "our_prob must be in (0,1)")
    if bookie_odds <= 1.0: return _no_bet(bankroll, our_prob, bookie_odds, "Odds must be > 1.0")
    b = bookie_odds - 1; q = 1.0 - our_prob
    edge_pct = (our_prob * bookie_odds - 1) * 100
    full_kelly = (b * our_prob - q) / b
    if full_kelly <= 0: return _no_bet(bankroll, our_prob, bookie_odds, f"Negative Kelly ({full_kelly:.3f})", edge_pct)
    quarter_kelly = full_kelly * fraction
    raw_bet  = quarter_kelly * bankroll
    bet_size = min(raw_bet, bankroll * max_pct)
    reason = f"Kelly={full_kelly*100:.1f}% → ×{fraction} → {quarter_kelly*100:.1f}%"
    if raw_bet > bankroll * max_pct: reason += f" (capped at {max_pct*100:.0f}%)"
    return KellyResult(round(our_prob,4), bookie_odds, round(full_kelly,4), round(quarter_kelly,4),
                       round(bet_size,2), bankroll, round(edge_pct,2), "BET", reason)

def _no_bet(bankroll, our_prob, bookie_odds, reason, edge_pct=0.0) -> KellyResult:
    return KellyResult(our_prob, bookie_odds, 0.0, 0.0, 0.0, bankroll, round(edge_pct,2), "SKIP", reason)
```

---

### `backend/app/engine/live_filter.py`

```python
"""
360SCOUT — Live Value Bet Filter
Rules (in order):
  1. Ghost Signal   — block minute >= 85
  2. Edge minimum   — must be >= 5%
  3. Logic Mismatch — leading team can't have odds > 2.0 after minute 70
  4. Anti-Contradiction — model+score both point same team, block opposite
"""

import logging
logger = logging.getLogger(__name__)

def process_live_value_bet(elapsed, home_score, away_score, outcome, vb_data, primary_winner="") -> dict:
    if elapsed >= 85:
        return {"status": "SKIP", "reason": f"Ghost Signal — minute {elapsed} (>= 85)"}
    edge = float(vb_data.get("edge_percent") or 0)
    if edge < 5.0:
        return {"status": "SKIP", "reason": f"Edge too low ({edge:.1f}% < 5%)"}
    chosen_odds = float(vb_data.get("bookmaker_odds") or 0)
    if elapsed >= 70 and chosen_odds > 2.0:
        if home_score > away_score and outcome == "home":
            return {"status": "SKIP", "reason": f"Logic Mismatch — home leads {home_score}:{away_score} but odds={chosen_odds}"}
        if away_score > home_score and outcome == "away":
            return {"status": "SKIP", "reason": f"Logic Mismatch — away leads {away_score}:{home_score} but odds={chosen_odds}"}
    if elapsed >= 70 and primary_winner in ("home", "away"):
        if primary_winner == "home" and home_score > away_score and outcome == "away":
            return {"status": "SKIP", "reason": f"Anti-Contradiction — model+score home, blocking away at minute {elapsed}"}
        if primary_winner == "away" and away_score > home_score and outcome == "home":
            return {"status": "SKIP", "reason": f"Anti-Contradiction — model+score away, blocking home at minute {elapsed}"}
    return {"status": "SEND_ALERT"}
```

---

### `backend/app/scheduler.py`

```python
"""
360SCOUT — Background Scheduler (APScheduler)
Jobs:
  - Every 5 min:  fetch live matches + save predictions to DB + Telegram alerts
  - Every 60 min: update results for finished matches
  - Daily 23:00 IL: send daily results recap to Telegram
  - Daily 03:00 IL: cleanup expired cache entries
Redis jobstore with memory fallback.
"""

import os, logging, asyncio
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.redis import RedisJobStore
from apscheduler.executors.asyncio import AsyncIOExecutor

logger = logging.getLogger(__name__)
_scheduler = None

def _build_jobstores():
    redis_url = os.getenv("REDIS_URL", "")
    if redis_url:
        try:
            import redis; r = redis.from_url(redis_url, socket_timeout=3); r.ping()
            logger.info("Scheduler: using Redis jobstore")
            return {"default": RedisJobStore(url=redis_url)}
        except Exception as e:
            logger.warning(f"Redis unavailable, using memory jobstore: {e}")
    return {}

# job_fetch_live_matches() — every 5 min:
#   1. fetch fixtures → parallelize: The Odds API + OpenWeather + API-Sports odds
#   2. build_match_analysis_sync() per fixture
#   3. OLBG consensus enrichment (Playwright)
#   4. save_match_prediction() UPSERT
#   5. process_live_value_bet() filter → send_live_value_alert() / send_value_bet_alert()
#
# job_auto_update_results() — every 60 min:
#   Query matches with status='scheduled' AND match_date < NOW()-2h
#   For each: GET /fixtures?id={fid} → if FT/AET/PEN → update_match_result()
#
# job_daily_results_recap() — 23:00 IL:
#   get_today_results_recap() → send_daily_recap() to Telegram
#
# job_cleanup_cache() — 03:00 IL:
#   DELETE FROM api_cache WHERE expires_at < NOW()

def start_scheduler():
    global _scheduler
    _scheduler = AsyncIOScheduler(
        jobstores  = _build_jobstores(),
        executors  = {"default": AsyncIOExecutor()},
        job_defaults = {"coalesce": True, "max_instances": 1, "misfire_grace_time": 60},
    )
    _scheduler.add_job(job_fetch_live_matches,     "interval", minutes=5,  id="fetch_live",
                       replace_existing=True, next_run_time=datetime.now(timezone.utc))
    _scheduler.add_job(job_auto_update_results,    "interval", minutes=60, id="auto_results",   replace_existing=True)
    _scheduler.add_job(job_cleanup_cache,          "cron", hour=3,  minute=0, timezone=ISRAEL_TZ, id="cleanup_cache",  replace_existing=True)
    _scheduler.add_job(job_daily_results_recap,    "cron", hour=23, minute=0, timezone=ISRAEL_TZ, id="daily_recap",    replace_existing=True)
    _scheduler.start()
    return _scheduler

def stop_scheduler():
    global _scheduler
    if _scheduler and _scheduler.running: _scheduler.shutdown(wait=False)
```

---

### `backend/app/cache.py`

```python
"""
360SCOUT — Cache Layer (PostgreSQL-backed + file fallback)
Survives Railway restarts via DB. Falls back to files if DB is unavailable.
"""

import os, json, time, hashlib, logging
from pathlib import Path
from typing import Any, Optional
from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)
CACHE_DIR = Path(__file__).parent.parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

TTL_MAP = {
    "live":     2   * 60,   # 2 minutes
    "fixtures": 360 * 60,   # 6 hours
    "odds":     60  * 60,   # 1 hour
    "weather":  30  * 60,   # 30 minutes
    "stats":    360 * 60,   # 6 hours
    "injuries": 10  * 60,   # 10 minutes
}

def _hkey(key):       return hashlib.md5(key.encode()).hexdigest()
def _file_path(key):  return CACHE_DIR / f"{_hkey(key)}.json"

def _file_get(key, cache_type):
    # No exists() check — avoids TOCTOU race between check and read
    try:
        entry = json.loads(_file_path(key).read_text(encoding="utf-8"))
        ttl   = TTL_MAP.get(cache_type, 3600)
        if time.time() - entry.get("timestamp", 0) > ttl:
            _file_path(key).unlink(missing_ok=True); return None
        return entry["data"]
    except (FileNotFoundError, json.JSONDecodeError): return None
    except Exception: _file_path(key).unlink(missing_ok=True); return None

def _file_set(key, data, cache_type):
    try:
        _file_path(key).write_text(
            json.dumps({"key": key[:100], "type": cache_type, "timestamp": time.time(), "data": data},
                       ensure_ascii=False, separators=(",",":")}, encoding="utf-8")
    except Exception as e: logger.warning(f"File cache write error: {e}")

# Public API: get(key, cache_type) / set(key, data, cache_type)
# DB first, file fallback. Both written on set.
```

---

### `backend/app/db/database.py`

```python
"""
360SCOUT — Database Layer (asyncpg, no ORM)
Pool singleton. Migration runs on every startup (all IF NOT EXISTS — idempotent).
Tables: teams, matches, team_form, head_to_head, match_environment, referees,
        match_referee, injuries, match_psychology, match_predictions, bookmaker_odds,
        analysts, analyst_predictions, consensus_scores, prediction_results, api_cache
"""

import os, logging, asyncpg
from dotenv import load_dotenv
load_dotenv()

_pool = None
_last_error = None

def _build_dsn():
    url = os.getenv("DATABASE_URL", "")
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    if url.startswith("postgres://"): url = "postgresql://" + url[len("postgres://"):]
    return url

# MIGRATION_SQL — 15 tables + api_cache + indexes (see database.py for full SQL)
# All statements use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS

async def init_db():
    global _pool
    dsn = _build_dsn()
    _pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=10, command_timeout=60)
    async with _pool.acquire() as conn: await conn.execute(MIGRATION_SQL)

async def get_db():
    if _pool is None: await init_db()
    return _pool
```

---

### `backend/app/db/repository.py`

Key functions:

```
save_match_prediction(match_data)
  → UPSERT matches + match_predictions + bookmaker_odds

get_track_record(limit=50)
  → summary stats + resolved + pending predictions + by_league breakdown

update_match_result(fixture_id, home_score, away_score)
  → UPSERT prediction_results + update matches.status='finished'
  → Score analysts: correct_predictions += 1, win_rate = correct/total

create_analyst(name, expertise_league)
list_analysts()
submit_analyst_prediction(fixture_id, analyst_id, outcome, confidence)
get_match_analyst_predictions(fixture_id)
get_analyst_predictions_history(analyst_id, limit)
get_consensus_locks(limit)
  → matches where majority of analyst picks agree with algo_pick
get_today_results_recap(tz_name)
  → For Telegram daily recap: total/hits/cumulative_odds/vb stats
```

---

### `backend/app/telegram_bot.py`

```python
"""
360SCOUT — Telegram Alert Bot
Sends Value Bet alerts to Telegram channel automatically.
Dedup set _sent_signals prevents duplicate alerts per {fixture_id:outcome}.
World Cup matches get a premium format via format_world_cup_alert().
"""

# BOT_TOKEN, CHANNEL_ID from .env
# ENABLED = bool(BOT_TOKEN and CHANNEL_ID)
# _sent_signals: set[str] = set()   # "{fixture_id}:{outcome}"

# Functions:
#   send_message(text, parse_mode="Markdown")
#   send_value_bet_alert(match, outcome, vb)     — pre-game
#   send_live_value_alert(match, outcome, vb, bankroll=0)   — live (with Kelly if bankroll>0)
#   send_daily_recap(recap)                      — daily results summary
#   format_goals_row(home, away, gs)             — goals market table (monospace)
#   format_world_cup_alert(match, outcome, vb, is_live)    — World Cup premium format
#   test_bot()                                   — GET /getMe
```

---

### `backend/app/telegram_commands.py`

```python
"""
360SCOUT — Telegram Interactive Command Bot
Long-polling loop (runs inside FastAPI as an asyncio Task).
Only enabled when APP_ENV=production OR TELEGRAM_POLLING=1.

Commands:
  /start   — welcome + command list
  /signals — active Value Bets from DB
  /live    — live matches now (minute + score)
  /track   — Track Record: accuracy + units + yield
  /locks   — active consensus locks
"""

# POLLING_ENABLED = ENABLED and (TELEGRAM_POLLING=1 or APP_ENV=production)
# handle_command(text) → dispatches to handlers
# polling_loop() → getUpdates long-poll (25s timeout), handles 409 with 60s backoff
# start_command_bot() / stop_command_bot() → lifecycle
```

---

### `backend/app/api/routes/live.py` — Key Pipeline

This is the main API route file (1324 lines). Key sections:

**TRACKED_LEAGUES** (10 leagues: World Cup, UCL, UEL, PL, LaLiga, Serie A, Bundesliga, Ligue 1, Brazilian, MLS)

**Filter constants:**
```
TRACKED_LEAGUE_IDS = {1, 2, 3, 39, 140, 135, 78, 61, 71, 253}
MIN_MARKET_ODDS = 1.40   # skip near-certainties
```

**Data flow for `GET /api/live/matches`:**
```
1. fetch_todays_fixtures()
   → Priority: live all → scheduled today → recent 7 days (fallback)
   → Cache: live=2min, fixtures=6h

2. For each fixture (parallel):
   a. fetch_all_odds()     → The Odds API bulk h2h + totals (cache 15min)
   b. fetch_weather_for_city(city)  → OpenWeather (cache 30min)
   c. fetch_odds_apisports(fixture_id) → per-fixture Bet365 (cache 15min)

3. build_match_analysis_sync(fixture, all_odds, weather, fixture_odds)
   a. xG calibration priority:
      - real stats (extract_xg from /teams/statistics)
      - score-based estimate
      - Option B: _calibrate_xg_from_market() via O/U 2.5 Poisson inversion
   b. In-play xG decay: xg_remaining = xg_pre × (1 - elapsed/90) + goals_scored
   c. engine.predict(ctx) → 4-module weighted blend + MC
   d. Market recalibration: if xg_from_market → blend 60% vig-free + 40% model
   e. DynamicAdjuster: auto-rotation if injury_impact > 0.45, manual overrides
   f. calculate_value() per outcome (min 8% edge if xg_from_market, else 5%)
   g. GoalsEngine: calculate_goals_value() + calculate_under_over_25_edge()
   h. OLBG consensus enrichment (Playwright)
   i. passes_odds_threshold() filter

4. Response: {status, count, display_mode, matches[...]}
```

**xG Calibration (Option B):**
```python
S = 1/odds_home + 1/odds_draw + 1/odds_away   # vig sum
p_h = (1/odds_home) / S   # vig-free home prob
p_a = (1/odds_away) / S   # vig-free away prob
R = p_h / p_a             # strength ratio
# From O/U 2.5: binary-search λ s.t. P(X≤2|Poisson(λ)) ≈ p_under_fair
xg_total = _lambda_from_under25(p_under_fair)
xg_home = xg_total × h_split × (1.05 if home_advantage else 1.0)
xg_away = xg_total × a_split × (0.95 if home_advantage else 1.0)
```

**Routes:**
```
GET  /api/live/matches              — main pipeline (limit, demo fallback)
GET  /api/live/world-cup            — World Cup only
GET  /api/live/track-record         — accuracy stats from DB
POST /api/live/adjust/{fixture_id}  — manual adjustment override
GET  /api/live/adjustments          — list current manual adjustments
DELETE /api/live/adjust/{fixture_id} — clear manual override
GET  /api/live/cache/stats          — cache statistics
POST /api/live/cache/clear          — clear all cache
GET  /api/live/db/status            — DB connection status
POST /api/live/result               — record match result (fixture_id, home, away)
```

---

### `backend/app/tasks/olbg_scraper.py`

```python
"""
OLBG Expert Consensus Scraper (Playwright)
Scrapes home/draw/away consensus percentages from olbg.com.
In-memory cache (_cache: dict) prevents repeated scrapes for same URL.
"""

# build_olbg_url(home_team, away_team) → "https://www.olbg.com/football/{slug}-vs-{slug}"
# fetch_olbg_consensus(url) → {"home": 0.74, "draw": 0.15, "away": 0.11} | None
# olbg_to_analyst_predictions(consensus) → list of 10 simulated analyst picks
#
# Selectors tried in order:
#   1. .tips-st-percentage
#   2. .tip-percentage, [class*='percentage']
#   3. Regex fallback on full page content
```

---

### `backend/app/tasks/analyst365_client.py`

```python
"""
360SCOUT — Analyst365 API Client
Fetches live matches from /api/live/matches.
Playwright HTML monitor available via fetch_from_html() for visual verification.
"""

# fetch_live_matches(base_url, limit, days) → list[MatchSnapshot] sorted by edge desc
# fetch_world_cup_matches(base_url, limit, days) → World Cup only
# _parse_match(dict) → MatchSnapshot (fixture_id, teams, probs, value_bet, odds, score, etc.)
```

---

## Frontend

---

### `frontend/app/page.tsx`

```typescript
// Server Component (SSR) — fetches on each render
// getLiveMatches()  → GET /api/live/matches?limit=8 → getEnhancedMatches() (odds fallback)
// getDemoData()     → GET /api/matches/demo
// getTrackStats()   → GET /api/live/track-record?limit=100

// Layout:
//   Hero title (dynamic: Live / Signals / Analyses)
//   Stats bar: accuracy%, value bet count, match count, consensus locks
//   DashboardTabs (All / Live / World Cup) if real data
//   MatchCard (demo) if no real data
//   TelegramCTABanner
```

---

### `frontend/hooks/useLiveClock.ts`

```typescript
"use client";
import { useState, useEffect, useRef } from "react";

const TICKING_STATUSES = new Set(["1H", "2H", "ET", "LIVE"]);

export function useLiveClock(
  serverElapsed: number | null | undefined,
  statusShort: string | null | undefined
): string {
  const [localElapsed, setLocalElapsed] = useState<number>(serverElapsed ?? 0);
  const prevServerRef = useRef<number | null>(serverElapsed ?? null);
  const prevStatusRef = useRef<string | null>(statusShort ?? null);

  // Snap on elapsed change OR status transition (fixes HT→2H with elapsed=45 unchanged)
  useEffect(() => {
    const se = serverElapsed ?? null;
    if (se === null) return;
    if (se !== prevServerRef.current || statusShort !== prevStatusRef.current) {
      setLocalElapsed(prev => (se > prev ? se : prev));
      prevServerRef.current = se;
      prevStatusRef.current = statusShort ?? null;
    }
  }, [serverElapsed, statusShort]);

  // Cap prevents overflow during stoppage time, VAR delays, or long ET
  const isTicking = TICKING_STATUSES.has(statusShort ?? "");
  useEffect(() => {
    if (!isTicking) return;
    const id = setInterval(() => {
      const max = statusShort === "ET" ? 120 : statusShort === "2H" ? 90 : 45;
      setLocalElapsed(prev => Math.min(prev + 1, max));
    }, 60_000);
    return () => clearInterval(id);
  }, [isTicking, statusShort]);

  if (statusShort === "HT")  return "מחצית";
  if (statusShort === "FT" || statusShort === "AET" || statusShort === "PEN") return "נגמר";
  if (!statusShort || statusShort === "NS") return "";
  return `${localElapsed}'`;
}
```

---

### `frontend/hooks/useLivePolling.ts`

```typescript
"use client";
// Adaptive polling intervals:
//   Live (not HT): 20s
//   Live at HT:    35s
//   Scheduled:     90s
//   Idle (no games): 180s
//
// Odds-drift detection: if any live match odds shift ≥ 0.06 decimal,
//   schedule early re-fetch after 4s (market moved = likely goal)
//
// Key design: uses refs (not state) for concurrency guard and AbortController
// to cancel in-flight requests before starting new ones.

// useLivePolling(initialMatches) → { matches, lastUpdated, isPending }
```

---

### `frontend/utils/analytics.ts`

```typescript
/**
 * Frontend value-bet calculator — mirrors backend exactly.
 * edge = algo_prob × bookmaker_odds − 1
 * edgePct = edge × 100  (VALUE_THRESHOLD = 5.0%)
 * Display-only; authoritative flag is is_value_bet from API.
 */

export function calculateValueBets(algoProbs, marketOdds): ValueAnalysis {
  // Iterates home/draw/away, computes edge per outcome
  // Returns { hasValue, best (highest edge), breakdown[3] }
}

export function marketOddsFromValueBets(valueBets): MarketOdds | null {
  // Extracts homeOdds/drawOdds/awayOdds from API value_bets map
}
```

---

### `frontend/lib/valueBets.ts`

```typescript
// bestValueBet(valueBets) → [outcome, ValueBetEntry] | null  (highest edge_percent)
// maxEdge(valueBets)      → number  (0 when none, used for list sorting)
// Note: edge calculation lives in the backend only — this file only selects from results
```

---

### `frontend/lib/enhancedMatches.ts`

```typescript
// Server-side only (uses process.env)
// getEnhancedMatches(matches, { filterNoOdds = false })
//   → For any match missing odds: fetchFallbackOdds(homeTeam, awayTeam)
//      → The Odds API /sports/soccer/odds?markets=h2h (prefer Pinnacle)
//      → Fuzzy 6-char prefix match on team names
//   → Validate: odds must be > 1 (decimal); corrupt entries filtered
```

---

### `frontend/components/MatchCard.tsx`

Full-featured match card (1300+ lines). Sections:
- **Header**: league badge, consensus type badge, team logos, scoreboard, probability bars
- **Key Factors**: HEAVY_RAIN, EXTREME_HEAT, HIGH_ALTITUDE, injuries, strict referee, etc.
- **Footer**: expand toggle, value badge, goals signal badge, weather chip
- **Expanded** (on click):
  - `WinningMethodTable` — xG / probability / fair odds / market odds / edge per outcome
  - `GoalsMarketBlock` — Over/Under table (prob, odds, edge, rating) + BTTS + xG footer + signal badge
  - `ModuleChart` — stats/environment/human/psychology mini bars (home=green left, away=red right, direction:ltr)
  - Monte Carlo stats (simulations, confidence, MC leader)
  - Cross-check button → POST /api/matches/cross-check (injury data from API-Football)
  - Consensus panel → POST /api/matches/consensus-match (fetches on first expand)

UI conventions:
- `direction: "ltr"` on all scoreboard/probability elements — home always LEFT, away always RIGHT
- `ConfidenceRing` SVG component with animated stroke-dasharray
- `AnimatedBar` component with 0.8s cubic-bezier transition

---

### `frontend/components/MatchLiveRow.tsx`

Live in-play row for `LiveInPlayTab`. Shows:
- Red clock badge (useLiveClock), score, team names, league, data quality badge
- Model selection + confidence
- EdgePill grid (1 / X / 2) — green for value, grey for positive, red for negative
- Value alert banner (green if authoritative from backend, amber if frontend only)
- Telegram CTA button

`DataQualityBadge` shows xG source: "xG · Real" (blue) | "xG · Totals" (amber) | "xG · Est" (grey)

---

### `frontend/components/LiveInPlayTab.tsx`

```typescript
// Wraps useLivePolling for real-time updates
// Filters allMatches by _status === "live"
// Shows: header banner (Live badge, count, last-updated time, spinner)
// Empty state when live.length === 0
// List of MatchLiveRow components
```

---

### `frontend/components/DashboardTabs.tsx`

```typescript
// Tab state: "all" | "live" | "worldcup"
// All — LeagueFilteredMatches (full MatchCard list with league filter)
// Live — LiveInPlayTab (live in-play rows)
// World Cup — /world.?cup|fifa|מונדיאל/i filter on league name
```

---

## Database Schema

### `database/migrations/001_init.sql`

```sql
-- Run: psql -U postgres -d scout360 -f 001_init.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- TEAMS
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    country_code CHAR(3),
    api_football_id INTEGER UNIQUE,
    altitude_adaptation FLOAT DEFAULT 0.0,
    heat_adaptation FLOAT DEFAULT 0.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MATCHES
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_football_id INTEGER UNIQUE,
    home_team_id UUID REFERENCES teams(id), away_team_id UUID REFERENCES teams(id),
    home_team_name VARCHAR(100), away_team_name VARCHAR(100),
    league_name VARCHAR(100), league_id INTEGER,
    match_date TIMESTAMPTZ, venue VARCHAR(200), city VARCHAR(100),
    status VARCHAR(20) DEFAULT 'scheduled',
    home_score INTEGER, away_score INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TEAM FORM & STATS
CREATE TABLE IF NOT EXISTS team_form (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID REFERENCES teams(id), match_id UUID REFERENCES matches(id),
    xg_for FLOAT DEFAULT 0, xg_against FLOAT DEFAULT 0,
    possession FLOAT DEFAULT 50, shots_on_target INTEGER DEFAULT 0,
    ppda FLOAT DEFAULT 0, form_score FLOAT DEFAULT 0,
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- HEAD TO HEAD
CREATE TABLE IF NOT EXISTS head_to_head (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_a_id UUID REFERENCES teams(id), team_b_id UUID REFERENCES teams(id),
    matches_played INTEGER DEFAULT 0, team_a_wins INTEGER DEFAULT 0,
    team_b_wins INTEGER DEFAULT 0, draws INTEGER DEFAULT 0,
    avg_goals_total FLOAT DEFAULT 0, psychological_edge FLOAT DEFAULT 0,
    UNIQUE(team_a_id, team_b_id)
);

-- ENVIRONMENT
CREATE TABLE IF NOT EXISTS match_environment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    temperature_celsius FLOAT, humidity_percent FLOAT, wind_speed_kmh FLOAT,
    precipitation_mm FLOAT DEFAULT 0, altitude_meters INTEGER DEFAULT 0,
    weather_condition VARCHAR(50),
    home_weather_advantage FLOAT DEFAULT 0, away_weather_advantage FLOAT DEFAULT 0,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- REFEREES
CREATE TABLE IF NOT EXISTS referees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL, nationality VARCHAR(50),
    api_football_id INTEGER UNIQUE,
    avg_yellow_cards FLOAT DEFAULT 3.5, avg_red_cards FLOAT DEFAULT 0.2,
    avg_fouls_called FLOAT DEFAULT 25, penalty_rate FLOAT DEFAULT 0.15,
    home_bias_score FLOAT DEFAULT 0, big_match_experience INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS match_referee (
    match_id UUID REFERENCES matches(id), referee_id UUID REFERENCES referees(id),
    PRIMARY KEY (match_id, referee_id)
);

-- INJURIES
CREATE TABLE IF NOT EXISTS injuries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id), team_id UUID REFERENCES teams(id),
    player_name VARCHAR(100), position VARCHAR(20),
    impact_weight FLOAT DEFAULT 0.3, confirmed_out BOOLEAN DEFAULT FALSE,
    reported_at TIMESTAMPTZ DEFAULT NOW()
);

-- PSYCHOLOGY
CREATE TABLE IF NOT EXISTS match_psychology (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    crowd_size INTEGER DEFAULT 0, venue_type VARCHAR(20) DEFAULT 'neutral',
    tournament_stage VARCHAR(50) DEFAULT 'group', pressure_index FLOAT DEFAULT 0.5,
    rest_days_home INTEGER DEFAULT 7, rest_days_away INTEGER DEFAULT 7,
    travel_km_away INTEGER DEFAULT 0
);

-- PREDICTIONS
CREATE TABLE IF NOT EXISTS match_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    prob_home_stats FLOAT, prob_away_stats FLOAT, prob_draw_stats FLOAT,
    prob_home_env FLOAT, prob_away_env FLOAT, prob_draw_env FLOAT,
    prob_home_human FLOAT, prob_away_human FLOAT, prob_draw_human FLOAT,
    final_prob_home FLOAT, final_prob_away FLOAT, final_prob_draw FLOAT,
    monte_carlo_home FLOAT, monte_carlo_away FLOAT, monte_carlo_draw FLOAT,
    simulations_run INTEGER DEFAULT 10000, confidence_score FLOAT,
    edge_score FLOAT, key_factors JSONB DEFAULT '[]',
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ODDS
CREATE TABLE IF NOT EXISTS bookmaker_odds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id), bookmaker VARCHAR(50),
    odds_home FLOAT, odds_draw FLOAT, odds_away FLOAT,
    implied_prob_home FLOAT, implied_prob_draw FLOAT, implied_prob_away FLOAT,
    value_home FLOAT, value_draw FLOAT, value_away FLOAT,
    is_value_bet BOOLEAN DEFAULT FALSE,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ANALYSTS
CREATE TABLE IF NOT EXISTS analysts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL, expertise_league VARCHAR(100),
    win_rate FLOAT DEFAULT 0.50, total_predictions INTEGER DEFAULT 0,
    correct_predictions INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS analyst_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id), analyst_id UUID REFERENCES analysts(id),
    predicted_outcome VARCHAR(10),
    confidence_level INTEGER CHECK (confidence_level BETWEEN 1 AND 10),
    reasoning TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- CONSENSUS
CREATE TABLE IF NOT EXISTS consensus_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    analyst_consensus_home FLOAT, analyst_consensus_away FLOAT, analyst_consensus_draw FLOAT,
    agreement_type VARCHAR(30) DEFAULT 'ALGORITHM_ONLY',
    master_score_home FLOAT, master_score_away FLOAT, master_score_draw FLOAT,
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRACK RECORD
CREATE TABLE IF NOT EXISTS prediction_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) UNIQUE,
    predicted_outcome VARCHAR(10), actual_outcome VARCHAR(10),
    was_correct BOOLEAN, algorithm_was_correct BOOLEAN,
    value_bet_hit BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ DEFAULT NOW()
);

-- API CACHE
CREATE TABLE IF NOT EXISTS api_cache (
    key VARCHAR(255) PRIMARY KEY, cache_type VARCHAR(50),
    data TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_matches_date    ON matches(match_date);
CREATE INDEX IF NOT EXISTS idx_matches_status  ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_league  ON matches(league_id);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON match_predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_match      ON bookmaker_odds(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_value      ON bookmaker_odds(is_value_bet) WHERE is_value_bet = TRUE;
CREATE INDEX IF NOT EXISTS idx_cache_expires   ON api_cache(expires_at);
```

---

## Environment Variables

```bash
# API Keys
API_FOOTBALL_KEY=...        # v3.football.api-sports.io
ODDS_API_KEY=...            # api.the-odds-api.com/v4
OPENWEATHER_KEY=...         # api.openweathermap.org/data/2.5
ODDS_API_KEY=...            # frontend fallback (same key or different)

# Database (Railway PostgreSQL)
DATABASE_URL=postgresql://...

# Cache
REDIS_URL=redis://...       # optional — APScheduler Redis jobstore
API_FOOTBALL_CACHE_MINUTES=60

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHANNEL_ID=@your_channel
TELEGRAM_POLLING=1          # set to 1 for local polling (not needed on Railway)

# App
APP_ENV=development|production
PORT=8000

# Frontend (Next.js)
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
API_URL=https://your-backend.railway.app   # server-side only
ODDS_API_KEY=...                           # server-side for odds fallback
```

---

## Key Architectural Decisions

1. **Single source of truth for edge formula** — `calculate_value()` in prediction_model.py; frontend mirrors it in analytics.ts but defers to API flag `is_value_bet`.

2. **xG from market (Option B)** — Breaks the circularity of using 1X2 odds to derive xG: instead uses O/U 2.5 total λ from Poisson inversion, then splits by vig-free 1X2 ratio. When market-derived, requires 8% edge (vs 5%) to suppress noise.

3. **Market recalibration blend** — When xG is market-derived, final probs = 60% vig-free market + 40% model. Prevents underdog over-estimation from the non-stats modules (environment/human/psychology) all starting at 50-50.

4. **In-play xG decay** — `xg_remaining = xg_pre × (total_min − elapsed) / total_min + goals_scored` — applied during 1H/2H/ET statuses.

5. **_FACT precomputed factorials** — `np.array([factorial(k) for k in range(16)])` covers max_goals ≤ 15 from table; larger falls back to `math.factorial()`. Both `poisson_match_probabilities` and `poisson_goal_markets` have the same guard.

6. **direction:ltr convention** — Home ALWAYS left, away ALWAYS right in all UI (MatchCard, ModuleChart, probability bar). Hebrew text in labels, Latin team names from API unchanged. Set explicitly on the flex/grid container, not page-level RTL.

7. **useLiveClock** — Tracks both `prevServerRef` AND `prevStatusRef` so HT→2H transition (where `elapsed` stays at 45) forces a snap. Cap: `Math.min(prev + 1, max)` where max = ET?120 : 2H?90 : 45.

8. **Adaptive polling** — `useLivePolling` uses 4 intervals (20s/35s/90s/180s) based on match states. Odds drift ≥ 0.06 decimal schedules an early 4s refetch.

9. **Live filter chain** — Before any Telegram live alert: Ghost Signal (≥85min) → Edge minimum (5%) → Logic Mismatch (leading team at >2.0 after 70min) → Anti-Contradiction (model+score agree on one team, bet says other).

10. **No push to production** — git push requires explicit user approval. Tag `winning-method-v1` is locked; formulas must not change.

---

*End of CODEBASE_FULL.md*
