"""
360SCOUT — Goals Market Engine  v5.0  (Exclusive Liquidity Engine)
Full Poisson-based Over/Under prediction with Ultra xG Calibration.

Architecture:
  §0  calculate_ultra_calibrated_xg() — 12-factor exclusive calibration
  §1  XgModifiers   — all calibration inputs
  §2  adjust_xg()   — applies calibration + positional injury boosts
  §3  GoalsValueSignal — immutable result of a full O/U analysis
  §4  calculate_goals_value() — main entry point
  §5  injury_flags_from_list() — API injury list → XgModifiers

xG Calibration pipeline — calculate_ultra_calibrated_xg():
  xG × home_advantage × motivation × injuries × rest_multiplier × weather_factor
     × xt_modifier × lineup_value_ratio × lead_behavior
     × pace_factor × set_piece_matchup × fatigue_multiplier
  + ref_factor × 0.05

  rest_multiplier    = 0.92 if rest_days < 3 else 1.0
  weather_factor     = computed from precipitation_mm + temperature_c
  xt_modifier        = Expected Threat — dangerous-zone ball movement quality
  lineup_value_ratio = market value of starting XI vs full squad (1.0 = full strength)
  lead_behavior      = >1.0 keeps pressing when ahead; <1.0 sits back (defensive block)
  pace_factor        = shots rate normalized to global avg (12 shots/game = 1.0)
  set_piece_matchup  = 1.15 when high-efficiency attack meets high-vulnerability defense
  fatigue_multiplier = 1.10 when both teams have high late-goals proportion (>25%)

Positional layer (additive, separate):
  GK / key-defender absent → +0.15–0.25 to opponent's xG

Poisson PMF: P(X=k | λ) = exp(-λ)·λ^k/k!  (manual, no scipy)
  6×6 matrix (goals 0-5 per team).
"""

from __future__ import annotations

import dataclasses
import logging
import math
from dataclasses import dataclass
from typing import Literal

import numpy as np

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# §0  THE WINNING METHOD — 3-MULTIPLIER xG CALIBRATION
# ═══════════════════════════════════════════════════════════════════════════════

def calculate_ultra_calibrated_xg(
    base_xg:             float,
    home_adv:            float = 1.0,
    motivation:          float = 1.0,
    injuries:            float = 1.0,
    rest_days:           int   = 7,
    ref_factor:          float = 0.0,
    weather_factor:      float = 1.0,
    xt_modifier:         float = 1.0,
    lineup_value_ratio:  float = 1.0,
    lead_behavior:       float = 1.0,
    pace_factor:         float = 1.0,
    set_piece_matchup:   float = 1.0,
    fatigue_multiplier:  float = 1.0,
) -> float:
    """
    Exclusive Liquidity xG calibration — The Winning Method ultra model v5.

    Multipliers (applied in order):
      home_adv           : crowd + pitch boost (1.15 home, 1.0 away/neutral)
      motivation         : match-importance / tactical style edge
      injuries           : composite attacking-output factor (0.85 per striker out)
      rest_multiplier    : fatigue penalty when rest_days < 3 (×0.92)
      weather_factor     : derived from precipitation + temperature
      xt_modifier        : Expected Threat — dangerous-zone ball movement (xT proxy)
      lineup_value_ratio : market value ratio of starting XI; <1.0 = rotation/injuries
      lead_behavior      : >1.0 keeps pressing when ahead; <1.0 parks bus when leading
      pace_factor        : match intensity — shots rate vs global avg (12 shots/game)
      set_piece_matchup  : 1.15 when high-efficiency attack meets high-vulnerability defense
      fatigue_multiplier : 1.10 when late-goals avg > 0.25 (fatigue curve effect)

    Additive correction:
      ref_factor × 0.05 : referee tendency (positive = lenient; negative = strict)

    Returns calibrated xG, floored at 0.10.
    """
    rest_multiplier = 0.92 if rest_days < 3 else 1.0
    calibrated_xg   = base_xg * home_adv * motivation * injuries * rest_multiplier * weather_factor
    calibrated_xg  *= xt_modifier * lineup_value_ratio * lead_behavior
    calibrated_xg  *= pace_factor * set_piece_matchup * fatigue_multiplier
    calibrated_xg  += ref_factor * 0.05
    return max(0.10, round(calibrated_xg, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# §1  INPUT MODEL — XgModifiers
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class XgModifiers:
    """
    All contextual inputs that calibrate raw xG before the Poisson matrix.
    All fields default to neutral (no effect).

    Four calibration layers (applied in order by adjust_xg):
      Layer 1 — Multipliers (The Winning Method):
        home_advantage_multiplier : crowd + pitch boost for home team
        home_motivation / away_motivation : match-importance / tactical edge
        home_injuries_factor / away_injuries_factor : composite attacking factor
      Layer 2 — Weather (multiplicative, both teams equally):
        precipitation_mm, temperature_c
      Layer 3 — Positional absences (additive, boosts *opponent* xG):
        GK / key-defender absence creates a defensive hole the opponent exploits.
        Striker absence is captured by injuries_factor (Layer 1) — not duplicated.
      Layer 4 — Phenomenal Engine (multiplicative per team):
        xt_modifier        : Expected Threat — ball movement into dangerous zones
        lineup_value_ratio : starting XI market value vs full squad (<1.0 = rotation)
        lead_behavior      : attacking intent when ahead (>1.0 keeps pressing)
    """
    # ── Layer 1: The Winning Method ultra-calibration factors ────────────────
    home_advantage_multiplier: float = 1.0   # 1.15 home venue; 1.0 neutral/away
    home_motivation:           float = 1.0   # e.g. 1.10 must-win, 0.90 dead rubber
    away_motivation:           float = 1.0
    home_injuries_factor:      float = 1.0   # composite attacking factor; 0.85 striker out
    away_injuries_factor:      float = 1.0
    home_rest_days:            int   = 7     # days since last match; <3 triggers fatigue ×0.92
    away_rest_days:            int   = 7
    ref_factor:                float = 0.0   # referee tendency: +0.05 xG per unit (both teams)

    # ── Layer 2: Weather ──────────────────────────────────────────────────────
    precipitation_mm: float = 0.0    # mm/h — heavy rain degrades finishing
    temperature_c:    float = 20.0   # °C   — extreme cold/heat reduces output

    # ── Layer 3: Positional absences (boost opponent's xG) ───────────────────
    home_gk_injured:           bool = False  # backup GK → opponent gets xG boost
    away_gk_injured:           bool = False
    home_key_defender_injured: bool = False
    away_key_defender_injured: bool = False

    # ── Layer 4: Phenomenal Engine (v4 additions) ─────────────────────────────
    home_xt_modifier:        float = 1.0  # Expected Threat — dangerous-zone ball movement
    away_xt_modifier:        float = 1.0  # >1.0 efficient creation; <1.0 peripheral shots only
    home_lineup_value_ratio: float = 1.0  # starting XI market value vs full squad
    away_lineup_value_ratio: float = 1.0  # <1.0 = rotation (Cup rest, fixture congestion)
    home_lead_behavior:      float = 1.0  # >1.0 keeps pressing when leading; <1.0 parks bus
    away_lead_behavior:      float = 1.0

    # ── Layer 5: Exclusive Liquidity Engine (v5 additions) ────────────────────
    home_pace_factor:          float = 1.0  # match tempo: shots/game normalized to avg 12
    away_pace_factor:          float = 1.0
    home_set_piece_matchup:    float = 1.0  # 1.15 when high set-piece efficiency vs high vulnerability
    away_set_piece_matchup:    float = 1.0  # pre-computed cross-team factor
    home_fatigue_multiplier:   float = 1.0  # 1.10 when both teams have high late-goals ratio
    away_fatigue_multiplier:   float = 1.0


# ═══════════════════════════════════════════════════════════════════════════════
# §2  DYNAMIC xG ADJUSTER
# ═══════════════════════════════════════════════════════════════════════════════

# ── Effect magnitudes ─────────────────────────────────────────────────────────
# Calibrated from published xG-weather studies and injury-impact meta-analyses.
# Use multiplicative factors for weather (shared environment, preserves ratio)
# and additive deltas for injuries (positional risk, independent of base xG).

_RAIN_HEAVY_FACTOR   = 0.90   # >5 mm/h  → both teams ×0.90
_RAIN_SEVERE_FACTOR  = 0.84   # >10 mm/h → both teams ×0.84
_COLD_FACTOR         = 0.93   # <3 °C    → both teams ×0.93
_HEAT_FACTOR         = 0.91   # >35 °C   → both teams ×0.91

_GK_MISSING_BOOST      = 0.25   # backup GK → opponent +0.25 xG
_KEY_DEF_MISSING_BOOST = 0.15   # key CB/FB absent → opponent +0.15 xG
_XG_FLOOR              = 0.30   # absolute minimum per team (after all adjustments)


def _compute_weather_factor(precipitation_mm: float, temperature_c: float) -> float:
    """Derive a single weather multiplier from OpenWeather fields."""
    factor = 1.0
    if precipitation_mm > 10:
        factor *= _RAIN_SEVERE_FACTOR
    elif precipitation_mm > 5:
        factor *= _RAIN_HEAVY_FACTOR
    if temperature_c < 3:
        factor *= _COLD_FACTOR
    elif temperature_c > 35:
        factor *= _HEAT_FACTOR
    return factor


@dataclass(frozen=True)
class AdjustedXg:
    """Immutable result of adjust_xg(). Carries both raw and adjusted values."""
    xg_home_base: float
    xg_away_base: float
    xg_home:      float           # adjusted — use this for Poisson
    xg_away:      float
    delta_home:   float           # total Δ applied to home (for transparency)
    delta_away:   float
    modifiers_applied: tuple      # log of active modifiers (for debug/alerts)


def adjust_xg(
    xg_home: float,
    xg_away: float,
    mods: XgModifiers | None = None,
) -> AdjustedXg:
    """
    Apply the full ultra-calibration pipeline to raw xG.

    Order of operations:
      1. Ultra-calibration — calculate_ultra_calibrated_xg() per team
         (home_advantage × motivation × injuries × rest × weather + ref_factor)
      2. Positional absences — GK / key-defender out → additive boost to *opponent*
      3. Floor clip — max(_XG_FLOOR, result)

    Args:
        xg_home: Raw Expected Goals for home team
        xg_away: Raw Expected Goals for away team
        mods:    XgModifiers with all calibration inputs

    Returns:
        AdjustedXg with fully calibrated xg_home and xg_away
    """
    if mods is None:
        mods = XgModifiers()

    applied: list[str] = []

    # ── Step 1: Ultra-calibration (weather unified inside the function) ────────
    weather_factor = _compute_weather_factor(mods.precipitation_mm, mods.temperature_c)
    if weather_factor != 1.0:
        applied.append(f"weather(×{round(weather_factor, 3)})")

    h = calculate_ultra_calibrated_xg(
        float(xg_home),
        mods.home_advantage_multiplier,
        mods.home_motivation,
        mods.home_injuries_factor,
        mods.home_rest_days,
        mods.ref_factor,
        weather_factor,
        mods.home_xt_modifier,
        mods.home_lineup_value_ratio,
        mods.home_lead_behavior,
        mods.home_pace_factor,
        mods.home_set_piece_matchup,
        mods.home_fatigue_multiplier,
    )
    a = calculate_ultra_calibrated_xg(
        float(xg_away),
        1.0,                         # away team never gets home_advantage bonus
        mods.away_motivation,
        mods.away_injuries_factor,
        mods.away_rest_days,
        mods.ref_factor,
        weather_factor,
        mods.away_xt_modifier,
        mods.away_lineup_value_ratio,
        mods.away_lead_behavior,
        mods.away_pace_factor,
        mods.away_set_piece_matchup,
        mods.away_fatigue_multiplier,
    )

    if mods.home_advantage_multiplier != 1.0:
        applied.append(f"home_advantage(×{mods.home_advantage_multiplier})")
    if mods.home_motivation != 1.0:
        applied.append(f"home_motivation(×{mods.home_motivation})")
    if mods.away_motivation != 1.0:
        applied.append(f"away_motivation(×{mods.away_motivation})")
    if mods.home_injuries_factor != 1.0:
        applied.append(f"home_injuries(×{mods.home_injuries_factor})")
    if mods.away_injuries_factor != 1.0:
        applied.append(f"away_injuries(×{mods.away_injuries_factor})")
    if mods.home_rest_days < 3:
        applied.append(f"home_fatigue(rest={mods.home_rest_days}d,×0.92)")
    if mods.away_rest_days < 3:
        applied.append(f"away_fatigue(rest={mods.away_rest_days}d,×0.92)")
    if mods.ref_factor != 0.0:
        applied.append(f"referee(+{mods.ref_factor * 0.05:.2f}xG)")
    if mods.home_xt_modifier != 1.0:
        applied.append(f"home_xT(×{mods.home_xt_modifier})")
    if mods.away_xt_modifier != 1.0:
        applied.append(f"away_xT(×{mods.away_xt_modifier})")
    if mods.home_lineup_value_ratio != 1.0:
        applied.append(f"home_lineup(×{mods.home_lineup_value_ratio})")
    if mods.away_lineup_value_ratio != 1.0:
        applied.append(f"away_lineup(×{mods.away_lineup_value_ratio})")
    if mods.home_lead_behavior != 1.0:
        applied.append(f"home_lead_behavior(×{mods.home_lead_behavior})")
    if mods.away_lead_behavior != 1.0:
        applied.append(f"away_lead_behavior(×{mods.away_lead_behavior})")
    if mods.home_pace_factor != 1.0:
        applied.append(f"home_pace(×{mods.home_pace_factor})")
    if mods.away_pace_factor != 1.0:
        applied.append(f"away_pace(×{mods.away_pace_factor})")
    if mods.home_set_piece_matchup != 1.0:
        applied.append(f"home_setpiece_matchup(×{mods.home_set_piece_matchup})")
    if mods.away_set_piece_matchup != 1.0:
        applied.append(f"away_setpiece_matchup(×{mods.away_set_piece_matchup})")
    if mods.home_fatigue_multiplier != 1.0:
        applied.append(f"home_fatigue_curve(×{mods.home_fatigue_multiplier})")
    if mods.away_fatigue_multiplier != 1.0:
        applied.append(f"away_fatigue_curve(×{mods.away_fatigue_multiplier})")

    # ── Step 2: Positional absences — additive boost to *opponent* ───────────
    # Home GK/defender absent → away team scores more easily
    # Away GK/defender absent → home team scores more easily
    if mods.home_gk_injured:
        a += _GK_MISSING_BOOST
        applied.append(f"home_gk_out(away+{_GK_MISSING_BOOST})")
    if mods.away_gk_injured:
        h += _GK_MISSING_BOOST
        applied.append(f"away_gk_out(home+{_GK_MISSING_BOOST})")
    if mods.home_key_defender_injured:
        a += _KEY_DEF_MISSING_BOOST
        applied.append(f"home_key_def_out(away+{_KEY_DEF_MISSING_BOOST})")
    if mods.away_key_defender_injured:
        h += _KEY_DEF_MISSING_BOOST
        applied.append(f"away_key_def_out(home+{_KEY_DEF_MISSING_BOOST})")

    # ── Step 3: Floor ─────────────────────────────────────────────────────────
    h = max(_XG_FLOOR, h)
    a = max(_XG_FLOOR, a)

    return AdjustedXg(
        xg_home_base      = round(float(xg_home), 3),
        xg_away_base      = round(float(xg_away), 3),
        xg_home           = round(h, 3),
        xg_away           = round(a, 3),
        delta_home        = round(h - float(xg_home), 3),
        delta_away        = round(a - float(xg_away), 3),
        modifiers_applied = tuple(applied),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# §3  OUTPUT MODEL — GoalsValueSignal
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class GoalsValueSignal:
    """
    Immutable result of a full Over/Under goals analysis.
    Generated by calculate_goals_value().
    """
    line:           float     # goal line (default 2.5)

    # xG used (after modifiers)
    xg_home:        float
    xg_away:        float
    expected_total: float     # xg_home + xg_away

    # Probabilities (0–1) from Poisson matrix
    over_prob:      float
    under_prob:     float
    btts_yes_prob:  float     # both teams score ≥1
    btts_no_prob:   float

    # Bookmaker odds
    over_odds:      float
    under_odds:     float

    # EV% = (real_prob × bookmaker_odds − 1) × 100
    over_edge:      float
    under_edge:     float

    # Ratings: STRONG ≥25% | MODERATE ≥15% | WEAK ≥5% | NONE
    over_rating:    str
    under_rating:   str

    # Best actionable signal across Over/Under
    signal:        Literal["OVER", "UNDER", "NO_SIGNAL"]
    signal_edge:   float
    signal_rating: str

    # Modifier audit log (from AdjustedXg)
    modifiers_applied: tuple

    def to_dict(self) -> dict:
        """JSON-serialisable representation."""
        d = dataclasses.asdict(self)
        d["modifiers_applied"] = list(d["modifiers_applied"])
        return d


# ═══════════════════════════════════════════════════════════════════════════════
# §4  MAIN ENTRY POINT — calculate_goals_value()
# ═══════════════════════════════════════════════════════════════════════════════

def _ou_rating(edge_pct: float) -> str:
    if edge_pct >= 25.0: return "STRONG"
    if edge_pct >= 15.0: return "MODERATE"
    if edge_pct >= 5.0:  return "WEAK"
    return "NONE"


def _poisson_pmf(lam: float, max_goals: int) -> np.ndarray:
    """
    P(X=k | λ) = exp(-λ) · λ^k / k!  for k = 0..max_goals.
    Manual formula — identical to scipy.stats.poisson.pmf for λ in typical
    football xG range (0.3–4.0), no external dependency required.
    """
    return np.array(
        [math.exp(-lam) * (lam ** k) / math.factorial(k) for k in range(max_goals + 1)]
    )


def _poisson_matrix(lh: float, la: float, max_goals: int = 5) -> np.ndarray:
    """
    Build joint probability matrix P(home=h, away=a) for h,a in [0..max_goals].

    Uses the manual Poisson PMF: exp(-λ)·λ^k/k!
    Default max_goals=5 → 6×6 matrix covering goals 0-5 per team (range(6)),
    matching the user-specified Winning Method implementation.
    The matrix is renormalized so that over_prob + under_prob = 1.0 exactly.
    """
    home_pmf = _poisson_pmf(lh, max_goals)
    away_pmf = _poisson_pmf(la, max_goals)
    matrix   = np.outer(home_pmf, away_pmf)  # (max+1) × (max+1) joint prob
    total    = float(matrix.sum()) or 1.0
    return matrix / total                     # renormalize: sum to exactly 1.0


def calculate_goals_value(
    xg_home:    float,
    xg_away:    float,
    over_odds:  float,
    under_odds: float,
    line:       float = 2.5,
    mods:       XgModifiers | None = None,
    max_goals:  int = 5,
) -> GoalsValueSignal | None:
    """
    Full Over/Under goals market analysis using Poisson distribution.

    Pipeline:
      1. Validate inputs
      2. Adjust xG via weather + injury modifiers (adjust_xg)
      3. Build Poisson probability matrix (6×6, goals 0-5 per team)
      4. Sum matrix cells: Over (goal_sum > line), Under, BTTS
      5. Calculate EV% per market using The Winning Method formula
      6. Return best actionable signal

    Args:
        xg_home:    Raw home Expected Goals (from stats pipeline or odds calibration)
        xg_away:    Raw away Expected Goals
        over_odds:  Bookmaker decimal odds for Over {line}
        under_odds: Bookmaker decimal odds for Under {line}
        line:       Goal line threshold (default 2.5)
        mods:       Optional contextual modifiers (weather, injuries)
        max_goals:  Matrix size; 10 covers >99.9% of Poisson mass for λ≤5

    Returns:
        GoalsValueSignal if odds are valid, None otherwise
    """
    if over_odds <= 1.0 or under_odds <= 1.0:
        return None
    if xg_home <= 0 or xg_away <= 0:
        return None

    # ── Step 1: Dynamic xG adjustment ────────────────────────────────────────
    axg = adjust_xg(xg_home, xg_away, mods)
    lh  = max(axg.xg_home, 0.05)
    la  = max(axg.xg_away, 0.05)

    if axg.modifiers_applied:
        logger.debug(
            f"[GoalsEngine] xG adjusted: "
            f"home {axg.xg_home_base}→{axg.xg_home}  "
            f"away {axg.xg_away_base}→{axg.xg_away}  "
            f"mods={list(axg.modifiers_applied)}"
        )

    # ── Step 2: Poisson joint probability matrix ──────────────────────────────
    matrix = _poisson_matrix(lh, la, max_goals)

    # ── Step 3: Market probabilities ─────────────────────────────────────────
    ks       = np.arange(max_goals + 1)
    goal_sum = ks[:, None] + ks[None, :]          # h+a for every cell

    over_prob      = float(matrix[goal_sum >  line].sum())
    under_prob     = max(0.0, 1.0 - over_prob)
    btts_yes_prob  = float(matrix[1:, 1:].sum())  # P(home≥1 AND away≥1)
    btts_no_prob   = max(0.0, 1.0 - btts_yes_prob)

    # ── Step 4: EV% per market (The Winning Method) ───────────────────────────
    over_edge  = (over_prob  * over_odds  - 1) * 100
    under_edge = (under_prob * under_odds - 1) * 100

    # ── Step 5: Best signal ───────────────────────────────────────────────────
    best_name, best_edge = max(
        [("OVER", over_edge), ("UNDER", under_edge)],
        key=lambda x: x[1],
    )
    signal       = best_name if best_edge >= 5.0 else "NO_SIGNAL"
    signal_edge  = round(best_edge, 2) if signal != "NO_SIGNAL" else 0.0
    signal_rating = _ou_rating(best_edge)

    return GoalsValueSignal(
        line           = line,
        xg_home        = axg.xg_home,
        xg_away        = axg.xg_away,
        expected_total = round(lh + la, 2),
        over_prob      = round(over_prob,      4),
        under_prob     = round(under_prob,     4),
        btts_yes_prob  = round(btts_yes_prob,  4),
        btts_no_prob   = round(btts_no_prob,   4),
        over_odds      = over_odds,
        under_odds     = under_odds,
        over_edge      = round(over_edge,  2),
        under_edge     = round(under_edge, 2),
        over_rating    = _ou_rating(over_edge),
        under_rating   = _ou_rating(under_edge),
        signal         = signal,
        signal_edge    = signal_edge,
        signal_rating  = signal_rating,
        modifiers_applied = axg.modifiers_applied,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# §5  INJURY FLAGS HELPER — injury_flags_from_list()
# ═══════════════════════════════════════════════════════════════════════════════

# API-Football position strings that map to each role
_GK_POSITIONS  = {"goalkeeper"}
_DEF_POSITIONS = {"defender"}
_STR_POSITIONS = {"attacker", "forward"}

# Injury factor multipliers for own team's attacking output
_ATTACKER_FACTOR  = 0.85   # striker/forward out → own xG ×0.85
_MIDFIELDER_FACTOR = 0.95  # key midfielder out  → own xG ×0.95


def injury_flags_from_list(
    injuries:                  list,
    home_team_id:              int,
    away_team_id:              int,
    weather:                   dict | None = None,
    home_advantage_multiplier: float = 1.0,
) -> XgModifiers:
    """
    Convert an API-Football /injuries response + context into XgModifiers.

    Position handling:
      Goalkeeper / Defender → sets gk/defender flag (boosts *opponent* xG additively)
      Attacker / Forward    → reduces team's *own* injuries_factor (multiplicative)
      Midfielder            → slight reduction to team's own injuries_factor

    The `home_advantage_multiplier` is passed directly from the call site
    (typically 1.15 for home venues, 1.0 for neutral grounds).

    If `injuries` is empty, returns XgModifiers with all defaults (safe no-op).

    Args:
        injuries:                  list from API-Football /injuries endpoint
        home_team_id:              API team ID for home side
        away_team_id:              API team ID for away side
        weather:                   OpenWeather dict (temperature_celsius, precipitation_mm)
        home_advantage_multiplier: crowd + pitch boost; 1.15 home, 1.0 neutral
    """
    w    = weather or {}
    prec = float(w.get("precipitation_mm",    0.0))
    temp = float(w.get("temperature_celsius", 20.0))

    home_inj = [i for i in (injuries or []) if i.get("team", {}).get("id") == home_team_id]
    away_inj = [i for i in (injuries or []) if i.get("team", {}).get("id") == away_team_id]

    def _classify(team_injuries: list) -> tuple[dict, float]:
        flags  = {"gk": False, "def": False}
        factor = 1.0
        for inj in team_injuries:
            pos = (inj.get("player", {}).get("position") or "").strip().lower()
            if pos in _GK_POSITIONS:
                flags["gk"] = True
            elif pos in _DEF_POSITIONS:
                flags["def"] = True
            elif pos in _STR_POSITIONS:
                factor *= _ATTACKER_FACTOR   # each missing attacker compounds
        return flags, max(0.50, factor)      # floor at 50% to prevent extreme values

    hf, h_inj_factor = _classify(home_inj)
    af, a_inj_factor = _classify(away_inj)

    return XgModifiers(
        home_advantage_multiplier = home_advantage_multiplier,
        home_injuries_factor      = h_inj_factor,
        away_injuries_factor      = a_inj_factor,
        precipitation_mm          = prec,
        temperature_c             = temp,
        home_gk_injured           = hf["gk"],
        away_gk_injured           = af["gk"],
        home_key_defender_injured = hf["def"],
        away_key_defender_injured = af["def"],
    )
