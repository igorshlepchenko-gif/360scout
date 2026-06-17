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

# ── Poisson goal-distribution model (The Winning Method) ──────────────────────
_FACT = np.array([math.factorial(k) for k in range(16)], dtype=float)


def poisson_match_probabilities(xg_home: float, xg_away: float, max_goals: int = 8) -> dict:
    """
    ממיר xG לשתי הקבוצות להסתברויות 1/X/2 דרך מטריצת פואסון.
    matrix[h][a] = P(בית=h, חוץ=a). בית מנצח = מתחת לאלכסון, חוץ = מעל, תיקו = האלכסון.
    מנורמל ל-1 כדי לפצות על קטיעת הזנב ב-max_goals.
    """
    lh = max(float(xg_home), 0.30)
    la = max(float(xg_away), 0.30)
    ks = np.arange(max_goals + 1)
    fact = _FACT[:max_goals + 1] if max_goals < len(_FACT) else np.array(
        [math.factorial(k) for k in ks], dtype=float
    )
    home_pmf = np.exp(-lh) * lh ** ks / fact
    away_pmf = np.exp(-la) * la ** ks / fact
    matrix = np.outer(home_pmf, away_pmf)

    home = float(np.tril(matrix, -1).sum())   # h > a
    away = float(np.triu(matrix,  1).sum())   # a > h
    draw = float(np.trace(matrix))            # h == a
    total = home + draw + away or 1.0
    return {"home": home / total, "draw": draw / total, "away": away / total}


def poisson_goal_markets(xg_home: float, xg_away: float, line: float = 2.5, max_goals: int = 10) -> dict:
    """
    שווקי שערים מאותה מטריצת פואסון: Over/Under (ברירת מחדל 2.5) ו-BTTS.
    סוכם את תאי המטריצה לפי סכום השערים (h+a) ולפי שתי הקבוצות שכבשו.
    """
    lh = max(float(xg_home), 0.30)
    la = max(float(xg_away), 0.30)
    ks = np.arange(max_goals + 1)
    fact = _FACT[: max_goals + 1] if max_goals < len(_FACT) else np.array([math.factorial(k) for k in ks], dtype=float)
    home_pmf = np.exp(-lh) * lh ** ks / fact
    away_pmf = np.exp(-la) * la ** ks / fact
    matrix = np.outer(home_pmf, away_pmf)
    total = float(matrix.sum()) or 1.0

    # סכום השערים בכל תא: h + a
    goal_sum = ks[:, None] + ks[None, :]
    over = float(matrix[goal_sum > line].sum()) / total
    under = max(0.0, 1.0 - over)

    # BTTS — שתי הקבוצות כובשות לפחות שער (h>=1 וגם a>=1)
    btts_yes = float(matrix[1:, 1:].sum()) / total
    btts_no = max(0.0, 1.0 - btts_yes)

    return {
        "line":      line,
        "over":      round(over, 4),
        "under":     round(under, 4),
        "btts_yes":  round(btts_yes, 4),
        "btts_no":   round(btts_no, 4),
    }


@dataclass
class MatchContext:
    """All inputs needed for a full 360° prediction"""

    # --- Stats Layer ---
    xg_home: float = 1.3
    xg_away: float = 1.1
    form_home: float = 0.0      # -1 (bad form) to +1 (great form)
    form_away: float = 0.0
    h2h_advantage: float = 0.0  # -1 to +1 (positive = home historical edge)
    possession_home: float = 50.0

    # --- Environmental Layer ---
    temperature: float = 20.0
    humidity: float = 50.0
    precipitation_mm: float = 0.0
    altitude_meters: int = 0
    home_heat_adaptation: float = 0.5   # 0-1
    away_heat_adaptation: float = 0.5

    # --- Human Factors ---
    referee_cards_per_game: float = 3.5
    referee_home_bias: float = 0.0      # -1 to +1
    referee_penalty_rate: float = 0.15
    home_injury_impact: float = 0.0     # 0 (none) to 1 (key players out)
    away_injury_impact: float = 0.0

    # --- Psychology ---
    crowd_size: int = 40000
    venue_type: str = "neutral"          # 'home' / 'away' / 'neutral'
    tournament_stage: str = "group"      # 'group' / 'knockout' / 'final'
    pressure_index: float = 0.5
    rest_days_home: int = 7
    rest_days_away: int = 7
    travel_km_away: int = 0

    # --- Meta ---
    match_id: Optional[str] = None
    home_team: str = "Home Team"
    away_team: str = "Away Team"


class PredictionEngine:
    """
    360-Degree Cross-Referencing Predictive Model.
    Each module outputs home/away/draw probabilities.
    Final output = weighted blend of all modules.
    """

    MODULE_WEIGHTS = {
        "stats":       0.40,
        "environment": 0.20,
        "human":       0.25,
        "psychology":  0.15,
    }

    def predict(self, ctx: MatchContext) -> dict:
        logger.info(f"Running prediction: {ctx.home_team} vs {ctx.away_team}")

        # Run each module
        stats  = self._stats_module(ctx)
        env    = self._environment_module(ctx)
        human  = self._human_factors_module(ctx)
        psych  = self._psychology_module(ctx)

        w = self.MODULE_WEIGHTS

        raw_home = (
            stats["home"]  * w["stats"]  +
            env["home"]    * w["environment"] +
            human["home"]  * w["human"]  +
            psych["home"]  * w["psychology"]
        )
        raw_away = (
            stats["away"]  * w["stats"]  +
            env["away"]    * w["environment"] +
            human["away"]  * w["human"]  +
            psych["away"]  * w["psychology"]
        )

        final = self._to_three_way(raw_home, raw_away, ctx)
        mc    = self._monte_carlo(final, n=10000)
        conf  = self._confidence(stats, env, human, psych, final, mc, ctx)

        return {
            "match_id":   ctx.match_id,
            "home_team":  ctx.home_team,
            "away_team":  ctx.away_team,
            "final": {
                "home": round(final["home"], 4),
                "draw": round(final["draw"], 4),
                "away": round(final["away"], 4),
            },
            "recommendation": get_recommendation(
                final, ctx.home_team, ctx.away_team
            ),
            "by_module": {
                "stats":       stats,
                "environment": env,
                "human":       human,
                "psychology":  psych,
            },
            "monte_carlo": {
                "home": round(mc["home"], 4),
                "draw": round(mc["draw"], 4),
                "away": round(mc["away"], 4),
                "simulations": 10000,
            },
            "confidence": round(conf, 1),
            "key_factors": self._key_factors(ctx),
        }

    # ------------------------------------------------------------------ #
    #  MODULE 1 — Stats (xG, form, H2H)                                   #
    # ------------------------------------------------------------------ #
    def _stats_module(self, ctx: MatchContext) -> dict:
        # Poisson goal matrix → statistically-grounded 1/X/2 from xG
        p = poisson_match_probabilities(ctx.xg_home, ctx.xg_away)
        home, draw, away = p["home"], p["draw"], p["away"]

        # Form: ±15% swing, H2H: ±8% swing — applied to home/away
        home += ctx.form_home * 0.15 + ctx.h2h_advantage * 0.08
        away += ctx.form_away * 0.15 - ctx.h2h_advantage * 0.08

        # renormalize across all three (keeps the Poisson draw weight)
        home = max(home, 0.02)
        away = max(away, 0.02)
        total = home + draw + away
        return {"home": round(home / total, 4),
                "draw": round(draw / total, 4),
                "away": round(away / total, 4)}

    # ------------------------------------------------------------------ #
    #  MODULE 2 — Environmental                                            #
    # ------------------------------------------------------------------ #
    def _environment_module(self, ctx: MatchContext) -> dict:
        h = 0.50
        a = 0.50

        # Heavy rain → slows pace, hurts technical teams
        if ctx.precipitation_mm > 5:
            penalty = min(ctx.precipitation_mm / 50, 0.12)
            h += penalty * 0.3
            a -= penalty * 0.3

        # Extreme heat + humidity
        if ctx.temperature > 28 and ctx.humidity > 70:
            stress = (ctx.temperature - 28) * 0.01 + (ctx.humidity - 70) * 0.005
            delta = (ctx.home_heat_adaptation - ctx.away_heat_adaptation) * stress
            h += delta
            a -= delta

        # High altitude (>2000m)
        if ctx.altitude_meters > 2000:
            alt_factor = (ctx.altitude_meters - 2000) / 1000 * 0.08
            h += alt_factor * 0.6
            a -= alt_factor * 0.4

        return self._normalize_two(h, a)

    # ------------------------------------------------------------------ #
    #  MODULE 3 — Human Factors (referee + injuries)                      #
    # ------------------------------------------------------------------ #
    def _human_factors_module(self, ctx: MatchContext) -> dict:
        h = 0.50
        a = 0.50

        # Strict referee → hurts aggressive away team
        if ctx.referee_cards_per_game > 4:
            penalty = (ctx.referee_cards_per_game - 4) * 0.02
            a -= penalty
            h += penalty * 0.5

        # Referee home bias
        h += ctx.referee_home_bias * 0.05
        a -= ctx.referee_home_bias * 0.05

        # Injuries (each 0.1 impact → ~3% probability swing)
        h -= ctx.home_injury_impact * 0.30
        a -= ctx.away_injury_impact * 0.30

        return self._normalize_two(h, a)

    # ------------------------------------------------------------------ #
    #  MODULE 4 — Psychology (crowd, stage, fatigue)                      #
    # ------------------------------------------------------------------ #
    def _psychology_module(self, ctx: MatchContext) -> dict:
        h = 0.50
        a = 0.50

        # Crowd boost (max +10% for home)
        if ctx.venue_type == "home":
            boost = min(ctx.crowd_size / 10_000 * 0.015, 0.10)
            h += boost
        elif ctx.venue_type == "away":
            a += min(ctx.crowd_size / 10_000 * 0.010, 0.07)

        # Tournament pressure
        stage_map = {
            "group_dead_rubber": -0.03,
            "group_must_win":     0.03,
            "group":              0.00,
            "knockout":           0.05,
            "final":              0.07,
        }
        adj = stage_map.get(ctx.tournament_stage, 0) * ctx.pressure_index
        h += adj

        # Fatigue: fewer rest days = worse performance
        rest_diff = ctx.rest_days_home - ctx.rest_days_away
        fatigue = np.clip(rest_diff * 0.02, -0.08, 0.08)
        h += fatigue
        a -= fatigue

        # Long travel penalty for away team
        if ctx.travel_km_away > 5000:
            travel_penalty = min((ctx.travel_km_away - 5000) / 10_000, 0.05)
            a -= travel_penalty

        return self._normalize_two(h, a)

    # ------------------------------------------------------------------ #
    #  Monte Carlo — 10,000 simulations                                   #
    # ------------------------------------------------------------------ #
    def _monte_carlo(self, base_probs: dict, n: int = 10_000) -> dict:
        p       = np.array([base_probs["home"], base_probs["draw"], base_probs["away"]])
        noise   = np.random.normal(0, 0.04, (n, 3))
        samples = np.clip(p + noise, 0.01, 0.98)
        samples /= samples.sum(axis=1, keepdims=True)
        # Vectorized winner selection via inverse CDF (equivalent to np.random.choice per row)
        cumsum  = samples.cumsum(axis=1)
        u       = np.random.uniform(size=(n, 1))
        winners = (u > cumsum).sum(axis=1)          # 0=home, 1=draw, 2=away
        counts  = np.bincount(winners, minlength=3)
        total   = float(counts.sum())
        return {
            "home": counts[0] / total,
            "draw": counts[1] / total,
            "away": counts[2] / total,
        }

    # ------------------------------------------------------------------ #
    #  Confidence — נוסחה מלאה: דומיננטיות + פרש + MC + נתונים + הסכמה  #
    # ------------------------------------------------------------------ #
    def _confidence(self, *args) -> float:
        """
        4 גורמים:
        1. דומיננטיות  (40%) — כמה גבוהה ההסתברות הגבוהה ביחס ל-33%
        2. פרש עליון   (30%) — פרש בין מקום 1 למקום 2
        3. MC התכנסות  (20%) — Monte Carlo מסכים עם final
        4. עושר נתונים (10%) — H2H / צורה / פציעות אמיתיים

        טווח תוצאה: 20%–90%
        """
        *modules_plus, ctx = args
        *modules, final, mc = modules_plus

        # ─── 1. דומיננטיות ───────────────────────────────────────────────
        max_p = max(final["home"], final["draw"], final["away"])
        dominance = (max_p - 0.333) / 0.667        # 0 (כפות) → 1 (וודאי)
        dominance_score = min(dominance * 1.5, 1.0)

        # ─── 2. פרש עליון ────────────────────────────────────────────────
        probs_sorted = sorted([final["home"], final["draw"], final["away"]], reverse=True)
        gap = probs_sorted[0] - probs_sorted[1]
        gap_score = min(gap / 0.22, 1.0)           # 22% פרש = ניקוד מלא

        # ─── 3. Monte Carlo התכנסות ───────────────────────────────────────
        # MC_winner תואם final_winner → ביטחון עולה
        final_winner = max(final, key=final.get)
        mc_winner    = max(mc,    key=lambda k: mc[k] if k != "simulations" else 0)
        mc_agree     = 1.0 if final_winner == mc_winner else 0.3
        mc_strength  = mc.get(final_winner, 0)      # עד כמה MC בטוח
        mc_score     = mc_agree * min(mc_strength * 2.0, 1.0)

        # ─── 4. עושר נתונים ──────────────────────────────────────────────
        data_score = 0.0
        if ctx is not None:
            if ctx.h2h_advantage != 0.0:           data_score += 0.30  # H2H אמיתי
            if ctx.form_home != 0.0:               data_score += 0.20  # צורה אמיתית
            if ctx.home_injury_impact != 0.0 or ctx.away_injury_impact != 0.0:
                                                   data_score += 0.25  # פציעות
            if ctx.temperature != 20.0:            data_score += 0.15  # מזג אוויר חי
            if ctx.referee_home_bias != 0.0:       data_score += 0.10  # שופט
        data_score = min(data_score, 1.0)

        # ─── שילוב ───────────────────────────────────────────────────────
        combined = (
            0.40 * dominance_score +
            0.30 * gap_score       +
            0.20 * mc_score        +
            0.10 * data_score
        )
        confidence = combined * 70 + 20            # טווח: 20%–90%
        return round(max(20.0, min(90.0, confidence)), 1)

    # ------------------------------------------------------------------ #
    #  Key Factors — what's driving the prediction                        #
    # ------------------------------------------------------------------ #
    def _key_factors(self, ctx: MatchContext) -> list:
        factors = []

        if ctx.precipitation_mm > 10:
            factors.append({"factor": "HEAVY_RAIN", "impact": "HIGH",
                            "detail": f"{ctx.precipitation_mm}mm expected"})
        if ctx.temperature > 30 and ctx.humidity > 70:
            factors.append({"factor": "EXTREME_HEAT", "impact": "HIGH",
                            "detail": f"{ctx.temperature}°C / {ctx.humidity}% humidity"})
        if ctx.altitude_meters > 2000:
            factors.append({"factor": "HIGH_ALTITUDE", "impact": "HIGH",
                            "detail": f"{ctx.altitude_meters}m above sea level"})
        if ctx.home_injury_impact > 0.5:
            factors.append({"factor": "HOME_KEY_INJURY", "impact": "CRITICAL",
                            "detail": f"{ctx.home_injury_impact:.0%} squad impact"})
        if ctx.away_injury_impact > 0.5:
            factors.append({"factor": "AWAY_KEY_INJURY", "impact": "CRITICAL",
                            "detail": f"{ctx.away_injury_impact:.0%} squad impact"})
        if ctx.referee_cards_per_game > 5:
            factors.append({"factor": "STRICT_REFEREE", "impact": "HIGH",
                            "detail": f"{ctx.referee_cards_per_game:.1f} cards/game avg"})
        if ctx.tournament_stage in ["knockout", "final"]:
            factors.append({"factor": "ELIMINATION_PRESSURE", "impact": "MEDIUM",
                            "detail": ctx.tournament_stage.replace("_", " ").title()})
        if ctx.travel_km_away > 8000:
            factors.append({"factor": "LONG_TRAVEL", "impact": "MEDIUM",
                            "detail": f"{ctx.travel_km_away:,}km traveled"})

        return factors

    # ------------------------------------------------------------------ #
    #  Helpers                                                            #
    # ------------------------------------------------------------------ #
    def _normalize_two(self, home: float, away: float) -> dict:
        """Normalize home/away, then assign draw from remainder."""
        h = float(np.clip(home, 0.05, 0.80))
        a = float(np.clip(away, 0.05, 0.80))
        total = h + a
        if total > 0.85:
            h = h / total * 0.85
            a = a / total * 0.85
        d = 1.0 - h - a
        return {"home": round(h, 4), "draw": round(max(d, 0.05), 4), "away": round(a, 4)}

    def _to_three_way(self, raw_home: float, raw_away: float,
                      ctx: "MatchContext | None" = None) -> dict:
        """
        המרה לשלוש תוצאות עם הסתברות תיקו עצמאית.

        תיקו מבוסס על:
        - קרבת xG (ממוצע בפוטבול: ~26%)
        - שלב הטורניר (נוקאאוט = פחות תיקואים)
        - לחץ המשחק
        """
        # ─── חישוב הסתברות תיקו עצמאי ────────────────────────────────
        xg_home = ctx.xg_home if ctx else 1.3
        xg_away = ctx.xg_away if ctx else 1.1
        xg_diff = abs(xg_home - xg_away)

        # xG שווה = יותר תיקואים, פרש גדול = פחות (טווח: 14%–30%)
        base_draw = max(0.14, 0.30 - xg_diff * 0.07)

        # נוקאאוט / גמר — שחקנים לא מסתפקים בתיקו
        if ctx and ctx.tournament_stage in ("knockout", "final"):
            base_draw *= 0.60

        # לחץ גבוה (חייבים לנצח) — פחות תיקואים
        if ctx and ctx.pressure_index > 0.7:
            base_draw *= 0.85

        # ─── חלוקת השאר בין בית לאורחים ────────────────────────────────
        remaining = 1.0 - base_draw
        h = float(np.clip(raw_home, 0.01, 0.99))
        a = float(np.clip(raw_away, 0.01, 0.99))
        total_raw = h + a
        if total_raw > 0:
            home = remaining * h / total_raw
            away = remaining * a / total_raw
        else:
            home = away = remaining / 2

        # ─── נרמול סופי ──────────────────────────────────────────────────
        total = home + base_draw + away
        return {
            "home": round(home  / total, 4),
            "draw": round(base_draw / total, 4),
            "away": round(away  / total, 4),
        }


# ============================================================
# Value Bet Calculator
# ============================================================

_NO_VALUE = {"value": 0, "edge_percent": 0, "is_value_bet": False, "rating": "NONE"}

# Edge > 100% = impossible in real markets → reversed/stale odds mapping bug
_MAX_VALID_EDGE = 1.0

# Value-Trap guardrail:
# If our model gives a team < 40% prob AND the market gives it less than
# 60% of what we give it → likely the model is missing something
# (squad rotation, news, injury) rather than a genuine bookmaker error.
# Example: Belgium-Egypt → model=28%, market=15.2% → 15.2/28=0.54 < 0.60 → suppress.
_UNDERDOG_PROB_CAP       = 0.40   # extreme underdog threshold
_MARKET_DIVERGENCE_RATIO = 0.60   # market must agree to ≥ 60% of our prob


def calculate_value(our_prob: float, bookmaker_odds: float) -> dict:
    """
    Returns the statistical edge vs. the bookmaker.
    Positive value = we think it's more likely than the market.
    """
    if bookmaker_odds <= 1.0:
        return _NO_VALUE

    # Guardrail 1: auto-convert if caller accidentally passed percentage (e.g. 26 → 0.26)
    if our_prob > 1.0:
        our_prob = our_prob / 100.0

    implied_prob = 1 / bookmaker_odds
    value = (our_prob * bookmaker_odds) - 1

    # Guardrail 2: edge > 100% → odds are reversed / stale / wrong market
    if value > _MAX_VALID_EDGE:
        return _NO_VALUE

    edge_percent = value * 100  # EV% = (prob * odds − 1) × 100, consistent with value field

    # Guardrail 3: Value Trap — underdog + heavy market divergence
    # market gives team far less than our model → probably missing something
    market_divergence = implied_prob / our_prob   # < 1 means model > market
    is_suspicious = (
        our_prob < _UNDERDOG_PROB_CAP
        and market_divergence < _MARKET_DIVERGENCE_RATIO
    )

    rating = "NONE"
    if not is_suspicious:
        if value >= 0.25:
            rating = "STRONG"
        elif value >= 0.15:
            rating = "MODERATE"
        elif value >= 0.05:
            rating = "WEAK"

    return {
        "value":              round(value, 4),
        "edge_percent":       round(edge_percent, 2),
        "is_value_bet":       value > 0.05 and not is_suspicious,
        "is_suspicious":      is_suspicious,
        "rating":             rating,
        "our_prob":           round(our_prob, 4),
        "implied_prob":       round(implied_prob, 4),
        "market_divergence":  round(market_divergence, 3),
        "bookmaker_odds":     bookmaker_odds,
    }


# ============================================================
# Recommendation Layer (The Winning Method — draw filter)
# ============================================================

def get_recommendation(
    final_probs: dict,
    home_team: str = "Home",
    away_team: str = "Away",
    bookmaker_odds: Optional[dict] = None,
    draw_threshold: float = 0.28,
) -> dict:
    """
    Translates final_probs into a betting recommendation with draw-risk filter.

    draw_threshold : suppress 1X2 pick when prob_draw exceeds this (default 0.28).
    bookmaker_odds : optional {"home": float, "draw": float, "away": float}
                     used to compute edge on the recommended outcome.
    """
    prob_home = float(final_probs.get("home", 0.0))
    prob_draw = float(final_probs.get("draw", 0.0))
    prob_away = float(final_probs.get("away", 0.0))

    total = prob_home + prob_draw + prob_away or 1.0
    prob_home /= total
    prob_draw /= total
    prob_away /= total

    def _edge(prob: float, odds_key: str) -> Optional[float]:
        if not bookmaker_odds:
            return None
        odds = bookmaker_odds.get(odds_key)
        if not odds or float(odds) <= 1.0:
            return None
        return round((prob * float(odds) - 1) * 100, 2)

    if prob_draw > draw_threshold:
        if prob_home > prob_away:
            return {
                "recommendation": "Double Chance: 1X",
                "status":         "DOUBLE_CHANCE",
                "reason":         f"Draw prob {round(prob_draw * 100, 1)}% exceeds threshold — home stronger",
                "draw_prob":      round(prob_draw, 3),
                "edge":           None,
            }
        elif prob_away > prob_home:
            return {
                "recommendation": "Double Chance: X2",
                "status":         "DOUBLE_CHANCE",
                "reason":         f"Draw prob {round(prob_draw * 100, 1)}% exceeds threshold — away stronger",
                "draw_prob":      round(prob_draw, 3),
                "edge":           None,
            }
        else:
            return {
                "recommendation": "No Bet",
                "status":         "FILTERED_SYMMETRIC",
                "reason":         "Symmetric draw risk — no clear direction",
                "draw_prob":      round(prob_draw, 3),
                "edge":           None,
            }

    if prob_home >= prob_away:
        outcome = "home"
        label   = f"Home Win — {home_team}"
        prob    = prob_home
    else:
        outcome = "away"
        label   = f"Away Win — {away_team}"
        prob    = prob_away

    return {
        "recommendation": label,
        "outcome":        outcome,
        "status":         "APPROVED",
        "draw_prob":      round(prob_draw, 3),
        "prob":           round(prob, 3),
        "edge":           _edge(prob, outcome),
    }


# ============================================================
# Over/Under 2.5 Edge (Poisson)
# ============================================================

import math as _math

def calculate_under_over_25_edge(
    expected_goals: float,
    bookie_under_odds: float,
    bookie_over_odds: float,
    current_minutes: int = 0,
    current_goals: int = 0,
) -> dict | None:
    """
    חישוב Edge על Over/Under 2.5 — תומך בפרה-גיים ובלייב.

    expected_goals  : xG_home + xG_away (ציפייה לשערים למשחק מלא)
    current_minutes : דקה נוכחית (0 לפרה-גיים)
    current_goals   : שערים שכבר נכבשו (0 לפרה-גיים)
    """
    if bookie_under_odds <= 1.0 or bookie_over_odds <= 1.0:
        return None

    time_remaining = (90 - current_minutes) / 90
    if time_remaining <= 0:
        return None

    # אם כבר 3+ שערים — אנדר נגמר, אובר וודאי
    if current_goals >= 3:
        return {
            "expected_goals":  round(expected_goals, 2),
            "true_under_prob": 0.0,
            "true_over_prob":  100.0,
            "under_edge":      round((-1) * 100, 2),
            "over_edge":       round((bookie_over_odds - 1) * 100, 2),
            "under_rating":    "NONE",
            "over_rating":     _ou_rating((bookie_over_odds - 1) * 100),
            "bookie_under_odds": bookie_under_odds,
            "bookie_over_odds":  bookie_over_odds,
        }

    lambda_remaining = expected_goals * time_remaining
    max_future       = 2 - current_goals           # שערים מותרים נוספים לאנדר

    true_under_prob = sum(
        _math.exp(-lambda_remaining) * (lambda_remaining ** k) / _math.factorial(k)
        for k in range(max_future + 1)
    )
    true_over_prob = 1.0 - true_under_prob

    under_edge = (true_under_prob * bookie_under_odds - 1) * 100
    over_edge  = (true_over_prob  * bookie_over_odds  - 1) * 100

    return {
        "expected_goals":    round(expected_goals, 2),
        "true_under_prob":   round(true_under_prob * 100, 2),
        "true_over_prob":    round(true_over_prob  * 100, 2),
        "under_edge":        round(under_edge, 2),
        "over_edge":         round(over_edge,  2),
        "under_rating":      _ou_rating(under_edge),
        "over_rating":       _ou_rating(over_edge),
        "bookie_under_odds": bookie_under_odds,
        "bookie_over_odds":  bookie_over_odds,
    }


def _ou_rating(edge_pct: float) -> str:
    if edge_pct >= 25.0:
        return "STRONG"
    if edge_pct >= 15.0:
        return "MODERATE"
    if edge_pct >= 5.0:
        return "WEAK"
    return "NONE"


# ============================================================
# Consensus Engine
# ============================================================

def calculate_consensus(algorithm_probs: dict, analyst_predictions: list) -> dict:
    """
    Blends algorithm output with human analyst predictions.
    Returns type: LOCK | ALGORITHM_EDGE | DIVERGENCE | ALGORITHM_ONLY
    """
    if not analyst_predictions:
        return {
            "type":     "ALGORITHM_ONLY",
            "algorithm": algorithm_probs,
            "analysts":  None,
            "master":    algorithm_probs,
            "algo_edge": 0,
        }

    # Weighted average by analyst win_rate × confidence
    votes = {"home": 0.0, "away": 0.0, "draw": 0.0}
    total_weight = 0.0

    for pred in analyst_predictions:
        weight = pred.get("win_rate", 0.5) * pred.get("confidence", 5)
        votes[pred["outcome"]] += weight
        total_weight += weight

    if total_weight > 0:
        analyst = {k: v / total_weight for k, v in votes.items()}
    else:
        analyst = {"home": 1/3, "away": 1/3, "draw": 1/3}

    # Determine agreement type
    algo_winner    = max(algorithm_probs, key=algorithm_probs.get)
    analyst_winner = max(analyst, key=analyst.get)

    if algo_winner == analyst_winner:
        agreement = "LOCK"
    else:
        algo_edge = algorithm_probs.get(algo_winner, 0) - analyst.get(algo_winner, 0)
        agreement = "ALGORITHM_EDGE" if algo_edge > 0.15 else "DIVERGENCE"

    algo_edge_val = algorithm_probs.get(algo_winner, 0) - analyst.get(algo_winner, 0)

    # Master Score: 60% algorithm + 40% analysts
    master = {
        outcome: round(algorithm_probs[outcome] * 0.60 + analyst[outcome] * 0.40, 4)
        for outcome in ["home", "away", "draw"]
    }

    return {
        "type":      agreement,
        "algorithm": algorithm_probs,
        "analysts":  {k: round(v, 4) for k, v in analyst.items()},
        "master":    master,
        "algo_edge": round(algo_edge_val, 3),
    }


# ============================================================
# Halftime Matrix Recalculator
# ============================================================

def calculate_halftime_matrix(live_stats: dict, pre_match_matrix: dict) -> dict:
    """
    Bayesian update at HT: blends pre-match xG with actual H1 performance.
    Weights: 60% observed H1, 40% pre-match model.
    Floor: 0.30 (consistent with goals_engine._XG_FLOOR).
    """
    actual_h1_home = (
        live_stats.get("xg_home_h1")
        or live_stats.get("shots_on_target_home", 3) * 0.33
    )
    actual_h1_away = (
        live_stats.get("xg_away_h1")
        or live_stats.get("shots_on_target_away", 2) * 0.33
    )

    pre_xg_home = pre_match_matrix.get("xg_home", 1.3)
    pre_xg_away = pre_match_matrix.get("xg_away", 1.1)

    h2_xg_home = max(0.30, round(0.4 * pre_xg_home + 0.6 * actual_h1_home, 3))
    h2_xg_away = max(0.30, round(0.4 * pre_xg_away + 0.6 * actual_h1_away, 3))

    new_probs = poisson_match_probabilities(h2_xg_home, h2_xg_away)
    return {
        "xg_home_h2":  h2_xg_home,
        "xg_away_h2":  h2_xg_away,
        "prob_home":   new_probs["home"],
        "prob_draw":   new_probs["draw"],
        "prob_away":   new_probs["away"],
        "h1_xg_home":  round(float(actual_h1_home), 3),
        "h1_xg_away":  round(float(actual_h1_away), 3),
        "source":      "halftime_recalc",
    }


# ============================================================
# Goals Totals Scanner (Under/Over 1.5 & 2.5)
# ============================================================

def find_high_confidence_totals(
    matches: list, min_edge: float = 0.05
) -> dict:
    """
    Scans matches for value bets in Under/Over 1.5 and 2.5 markets.
    Returns four sorted lists (highest edge first).
    Requires each match dict to have: xg_home, xg_away,
    under_odds, over_odds, under_15_odds, over_15_odds.
    """
    under_25_picks: list = []
    over_25_picks:  list = []
    under_15_picks: list = []
    over_15_picks:  list = []

    for m in matches:
        home_team = m.get("home_team", "Unknown Home")
        away_team = m.get("away_team", "Unknown Away")
        xg_home   = float(m.get("xg_home", 1.3))
        xg_away   = float(m.get("xg_away", 1.1))

        try:
            probs_25 = poisson_goal_markets(xg_home, xg_away, line=2.5)
            probs_15 = poisson_goal_markets(xg_home, xg_away, line=1.5)
        except Exception as e:
            logger.error(f"Poisson failed for {home_team} vs {away_team}: {e}")
            continue

        raw_u25 = m.get("under_odds");    odds_u25 = float(raw_u25) if raw_u25 else None
        raw_o25 = m.get("over_odds");     odds_o25 = float(raw_o25) if raw_o25 else None
        raw_u15 = m.get("under_15_odds"); odds_u15 = float(raw_u15) if raw_u15 else None
        raw_o15 = m.get("over_15_odds");  odds_o15 = float(raw_o15) if raw_o15 else None

        def _pick(prob, odds, line):
            if not odds or prob <= 0:
                return None
            edge = (prob * odds) - 1
            if edge < min_edge:
                return None
            return {
                "match":       f"{home_team} vs {away_team}",
                "xg_total":    round(xg_home + xg_away, 2),
                "model_prob":  round(prob * 100, 1),
                "fair_odds":   round(1 / prob, 2),
                "market_odds": odds,
                "edge":        round(edge * 100, 2),
                "line":        line,
            }

        for prob, odds, bucket, line in [
            (probs_25["under"], odds_u25, under_25_picks, 2.5),
            (probs_25["over"],  odds_o25, over_25_picks,  2.5),
            (probs_15["under"], odds_u15, under_15_picks, 1.5),
            (probs_15["over"],  odds_o15, over_15_picks,  1.5),
        ]:
            pick = _pick(prob, odds, line)
            if pick:
                bucket.append(pick)

    _sort = lambda lst: sorted(lst, key=lambda x: x["edge"], reverse=True)
    return {
        "under_25_value_bets": _sort(under_25_picks),
        "over_25_value_bets":  _sort(over_25_picks),
        "under_15_value_bets": _sort(under_15_picks),
        "over_15_value_bets":  _sort(over_15_picks),
    }
