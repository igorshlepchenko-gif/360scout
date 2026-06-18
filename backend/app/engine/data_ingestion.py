"""
360SCOUT — Dynamic Data Ingestion  v1.0
Fetches real-time inputs for The Winning Method ultra-calibration engine.

Sources:
  1. Referee Stats  — API-Football /fixtures filtered by referee
                      Computes ref_factor from avg total goals (proxy for leniency)
  2. Team Playstyle — Derived from existing /teams/statistics response
                      No extra API calls required; optionally enhanced with
                      recent fixture statistics (shots/possession)
  3. Weather        — Already handled by fetch_weather_for_city() in live.py

Outputs wired into XgModifiers:
  ref_factor          →  XgModifiers.ref_factor
  home_motivation_adj →  XgModifiers.home_motivation
  away_motivation_adj →  XgModifiers.away_motivation
"""

from __future__ import annotations

import logging
from typing import Literal

import httpx

from app.cache import get as cache_get, set as cache_set

logger = logging.getLogger(__name__)

PlaystyleLabel = Literal["dominant_attacking", "counter_attack", "defensive", "balanced"]

# ── Baseline constants ────────────────────────────────────────────────────────
_BASELINE_GOALS_PER_GAME = 2.6   # UEFA/global average total goals per match
_REF_FACTOR_CAP          = 1.5   # clamp ref_factor to [-1.5, +1.5]


# ═══════════════════════════════════════════════════════════════════════════════
# §1  REFEREE STATS
# ═══════════════════════════════════════════════════════════════════════════════

async def fetch_referee_stats(
    referee_name: str,
    api_key:      str,
    api_base:     str,
    last:         int = 20,
) -> dict:
    """
    Fetch referee's recent match history and compute ref_factor.

    Makes ONE API call: GET /fixtures?last={last}&referee={name}
    Derives ref_factor from the average total goals across those fixtures —
    a well-validated proxy for referee leniency (lenient refs → more set-pieces
    → more goals via penalties/free-kicks).

    ref_factor formula:
      ref_factor = (avg_goals - BASELINE) / BASELINE
      where BASELINE = 2.6 (global average)

    Returns:
      {
        "ref_factor":         float,   # −1.5 to +1.5 (0.0 = neutral)
        "avg_goals_per_game": float,   # average total goals in referee's fixtures
        "fixtures_analysed":  int,
        "source":             str,
      }

    Cache: 24 hours per referee (assignments rarely change intra-season).
    """
    if not referee_name or not referee_name.strip():
        return _default_referee()
    if not api_key:
        return _default_referee("no_api_key")

    cache_key = f"referee:{referee_name.lower().replace(' ', '_')}"
    cached = await cache_get(cache_key, "referee")
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(
                f"{api_base}/fixtures",
                headers={"x-apisports-key": api_key},
                params={"last": last, "referee": referee_name},
            )
            if r.status_code != 200:
                logger.warning(f"[Referee] API returned {r.status_code} for {referee_name!r}")
                return _default_referee("api_error")

            fixtures = r.json().get("response", [])
    except Exception as exc:
        logger.warning(f"[Referee] fetch failed for {referee_name!r}: {exc}")
        return _default_referee("fetch_error")

    if not fixtures:
        result = _default_referee("no_data")
        await cache_set(cache_key, result, "referee")
        return result

    # Derive from fixture goals data (already in response — zero extra calls)
    total_goals = 0
    counted     = 0
    for fix in fixtures:
        goals = fix.get("goals") or {}
        h = goals.get("home")
        a = goals.get("away")
        if h is not None and a is not None:
            try:
                total_goals += int(h) + int(a)
                counted     += 1
            except (TypeError, ValueError):
                continue

    if counted == 0:
        result = _default_referee("no_goals_data")
        await cache_set(cache_key, result, "referee")
        return result

    avg_goals  = total_goals / counted
    raw_factor = (avg_goals - _BASELINE_GOALS_PER_GAME) / _BASELINE_GOALS_PER_GAME
    ref_factor = round(max(-_REF_FACTOR_CAP, min(_REF_FACTOR_CAP, raw_factor)), 3)

    result = {
        "ref_factor":         ref_factor,
        "avg_goals_per_game": round(avg_goals, 2),
        "fixtures_analysed":  counted,
        "source":             "api_football",
    }
    logger.info(
        f"[Referee] {referee_name!r}: avg_goals={avg_goals:.2f} "
        f"ref_factor={ref_factor:+.3f} ({counted} fixtures)"
    )
    await cache_set(cache_key, result, "referee")
    return result


def _default_referee(reason: str = "default") -> dict:
    return {
        "ref_factor":         0.0,
        "avg_goals_per_game": _BASELINE_GOALS_PER_GAME,
        "fixtures_analysed":  0,
        "source":             reason,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# §2  TEAM PLAYSTYLE CLASSIFICATION
# ═══════════════════════════════════════════════════════════════════════════════

def classify_team_playstyle(
    team_stats:          dict,
    recent_fixture_stats: list | None = None,
) -> dict:
    """
    Classify a team's tactical style from season statistics.

    Uses API-Football /teams/statistics data (already fetched — no extra API calls).
    Optionally enhanced by passing `recent_fixture_stats` (list of per-fixture
    statistics arrays from /fixtures/statistics) for possession + shots data.

    Classifications:
      dominant_attacking : high possession + high goals scored
      counter_attack     : low possession but efficient (high goals, low shots)
      defensive          : high clean-sheet rate + low goals scored
      balanced           : everything near league average

    Returns:
      {
        "style":             str,   # PlaystyleLabel
        "attack_strength":   float, # 0.70 – 1.30 relative to average
        "defense_strength":  float, # 0.70 – 1.30 (higher = fewer goals conceded)
        "avg_possession":    float, # percentage (50.0 if unknown)
        "avg_shots_pg":      float, # shots per game (12.0 if unknown)
        "clean_sheet_rate":  float, # 0.0 – 1.0
        "tactical_modifier": float, # direct motivation multiplier for XgModifiers
      }
    """
    # ── Extract season stats ──────────────────────────────────────────────────
    goals_for_avg  = 1.2
    goals_agt_avg  = 1.2
    clean_sheets   = 0
    games_played   = 1

    try:
        goals = team_stats.get("goals") or {}
        g_for = (goals.get("for")     or {}).get("average") or {}
        g_agt = (goals.get("against") or {}).get("average") or {}
        goals_for_avg = float(g_for.get("total") or 1.2) or 1.2
        goals_agt_avg = float(g_agt.get("total") or 1.2) or 1.2

        cs  = team_stats.get("clean_sheet") or {}
        clean_sheets = (cs.get("home") or 0) + (cs.get("away") or 0)

        fp = (team_stats.get("fixtures") or {}).get("played") or {}
        games_played = max(1, (fp.get("home") or 0) + (fp.get("away") or 0))
    except (TypeError, ValueError):
        pass

    clean_sheet_rate = clean_sheets / games_played

    # ── Extract possession + shots from recent fixture stats (optional) ───────
    avg_possession = 50.0
    avg_shots_pg   = 12.0

    if recent_fixture_stats:
        poss_vals  = [_extract_fixture_stat(fs, "Ball Possession") for fs in recent_fixture_stats]
        shots_vals = [_extract_fixture_stat(fs, "Total Shots")     for fs in recent_fixture_stats]
        poss_vals  = [v for v in poss_vals  if v is not None]
        shots_vals = [v for v in shots_vals if v is not None]
        if poss_vals:
            avg_possession = sum(poss_vals) / len(poss_vals)
        if shots_vals:
            avg_shots_pg   = sum(shots_vals) / len(shots_vals)

    # ── Compute strength indices ───────────────────────────────────────────────
    # Attack: relative to global avg (1.3 goals/game)
    attack_strength  = min(1.30, max(0.70, goals_for_avg / 1.30))
    # Defense: inverted — fewer goals conceded = higher strength
    defense_strength = min(1.30, max(0.70, 1.20 / max(goals_agt_avg, 0.50)))

    # ── Classify style ────────────────────────────────────────────────────────
    if avg_possession >= 55 and goals_for_avg >= 1.6:
        style             = "dominant_attacking"
        tactical_modifier = 1.10   # press high, dictate tempo → xG boost
    elif avg_possession < 44 and goals_for_avg >= 1.4:
        style             = "counter_attack"
        tactical_modifier = 0.97   # sit deep, lethal on break → slight xG discount
    elif clean_sheet_rate >= 0.35 and goals_for_avg < 1.3:
        style             = "defensive"
        tactical_modifier = 0.90   # compact low block → reduced xG
    else:
        style             = "balanced"
        tactical_modifier = 1.00

    # ── xT modifier — Expected Threat proxy from shot quality ────────────────
    # Conversion rate = goals_for_avg / avg_shots_pg.  Global avg ≈ 10.8% (1.3/12).
    # Teams that score from fewer shots are generating xT in higher-quality zones.
    _shot_conv = goals_for_avg / max(avg_shots_pg, 6.0)
    xt_modifier = round(min(1.20, max(0.85, 1.0 + (_shot_conv - 0.108) * 3.0)), 3)

    # ── Lead behavior — tendency to keep attacking (or not) when leading ──────
    # Derived from style: dominant teams keep pressing, defensive teams park bus.
    _lead_map = {
        "dominant_attacking": 1.05,
        "counter_attack":     0.97,
        "defensive":          0.92,
        "balanced":           1.00,
    }
    lead_behavior_factor = _lead_map.get(style, 1.00)

    return {
        "style":               style,
        "attack_strength":     round(attack_strength,  3),
        "defense_strength":    round(defense_strength, 3),
        "avg_possession":      round(avg_possession,   1),
        "avg_shots_pg":        round(avg_shots_pg,     1),
        "clean_sheet_rate":    round(clean_sheet_rate, 3),
        "tactical_modifier":   tactical_modifier,
        "xt_modifier":         xt_modifier,
        "lead_behavior_factor": lead_behavior_factor,
    }


def _extract_fixture_stat(stat_list: list, stat_name: str) -> float | None:
    """Extract named stat from a /fixtures/statistics response array."""
    for item in (stat_list or []):
        if item.get("type") == stat_name:
            val = item.get("value")
            if val is None:
                return None
            if isinstance(val, str):
                try:
                    return float(val.replace("%", "").strip())
                except ValueError:
                    return None
            try:
                return float(val)
            except (TypeError, ValueError):
                return None
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# §3  TACTICAL MATCHUP
# ═══════════════════════════════════════════════════════════════════════════════

#  Matchup delta table: (home_style, away_style) → (Δhome_motivation, Δaway_motivation)
#  Values represent the tactical edge one style has over another.
_MATCHUP_DELTAS: dict[tuple[str, str], tuple[float, float]] = {
    # Dominant attacking pressing high vs a deep defensive block
    ("dominant_attacking", "defensive"):       (+0.08, -0.06),
    # Dominant attacking vs counter-attack — risk of being caught on transition
    ("dominant_attacking", "counter_attack"):  (+0.03, +0.04),
    ("dominant_attacking", "balanced"):        (+0.05, -0.02),
    # Counter-attack benefits when facing a high line
    ("counter_attack", "dominant_attacking"):  (+0.04, +0.02),
    ("counter_attack", "defensive"):           (-0.02, +0.02),
    ("counter_attack", "balanced"):            (+0.01, -0.01),
    # Defensive bunker vs attacking team
    ("defensive", "dominant_attacking"):       (-0.06, +0.06),
    ("defensive", "counter_attack"):           (+0.02, -0.03),
    ("defensive", "balanced"):                 (-0.02, +0.01),
    # Balanced vs any style: minimal delta
    ("balanced", "dominant_attacking"):        (-0.03, +0.02),
    ("balanced", "counter_attack"):            (+0.01, -0.01),
    ("balanced", "defensive"):                 (+0.02, -0.02),
}


def calculate_tactical_matchup(
    home_playstyle: dict,
    away_playstyle: dict,
) -> dict:
    """
    Compute motivation multipliers from the tactical matchup between two teams.

    Returns:
      {
        "home_motivation_adj": float,  # e.g. 1.08 when dominant_attacking vs defensive
        "away_motivation_adj": float,
        "matchup_label":       str,    # e.g. "dominant_attacking_vs_defensive"
      }
    """
    home_style = home_playstyle.get("style", "balanced")
    away_style = away_playstyle.get("style", "balanced")

    d_home, d_away = _MATCHUP_DELTAS.get((home_style, away_style), (0.0, 0.0))

    return {
        "home_motivation_adj": round(1.0 + d_home, 3),
        "away_motivation_adj": round(1.0 + d_away, 3),
        "matchup_label":       f"{home_style}_vs_{away_style}",
    }
