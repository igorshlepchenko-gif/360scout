"""
360SCOUT — Core Prediction Engine
Layers: Stats → Environment → Human Factors → Psychology → Monte Carlo
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Optional
import logging

logger = logging.getLogger(__name__)


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
        xg_total = ctx.xg_home + ctx.xg_away + 1e-9
        base_home = ctx.xg_home / xg_total
        base_away = ctx.xg_away / xg_total

        # Form: ±15% swing
        base_home += ctx.form_home * 0.15
        base_away += ctx.form_away * 0.15

        # H2H: ±8% swing
        base_home += ctx.h2h_advantage * 0.08
        base_away -= ctx.h2h_advantage * 0.08

        return self._normalize_two(base_home, base_away)

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
        p = np.array([base_probs["home"], base_probs["draw"], base_probs["away"]])
        results = np.zeros(3)

        for _ in range(n):
            noise = np.random.normal(0, 0.04, 3)
            sample = np.clip(p + noise, 0.01, 0.98)
            sample /= sample.sum()
            winner = np.random.choice(3, p=sample)
            results[winner] += 1

        total = results.sum()
        return {
            "home": results[0] / total,
            "draw": results[1] / total,
            "away": results[2] / total,
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

def calculate_value(our_prob: float, bookmaker_odds: float) -> dict:
    """
    Returns the statistical edge vs. the bookmaker.
    Positive value = we think it's more likely than the market.
    """
    if bookmaker_odds <= 1.0:
        return {"value": 0, "edge_percent": 0, "is_value_bet": False, "rating": "NONE"}

    implied_prob = 1 / bookmaker_odds
    value = (our_prob * bookmaker_odds) - 1
    edge_percent = (our_prob - implied_prob) * 100

    rating = "NONE"
    if value > 0.20:
        rating = "STRONG"
    elif value > 0.10:
        rating = "MODERATE"
    elif value > 0.05:
        rating = "WEAK"

    return {
        "value":         round(value, 4),
        "edge_percent":  round(edge_percent, 2),
        "is_value_bet":  value > 0.05,
        "rating":        rating,
        "our_prob":      round(our_prob, 4),
        "implied_prob":  round(implied_prob, 4),
        "bookmaker_odds": bookmaker_odds,
    }


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
