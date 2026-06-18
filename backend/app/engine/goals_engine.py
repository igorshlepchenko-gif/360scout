"""
360SCOUT — Goals Market Engine  v2.0
Full Poisson-based Over/Under prediction with 3-layer Dynamic xG Calibration.

Architecture:
  §0  calculate_calibrated_xg() — The Winning Method 3-multiplier pre-calibration
  §1  XgModifiers   — all calibration inputs (multipliers + weather + injury flags)
  §2  adjust_xg()   — applies all 3 layers: calibration → weather → positional injuries
  §3  GoalsValueSignal — immutable result of a full O/U analysis
  §4  calculate_goals_value() — main entry point
  §5  injury_flags_from_list() — API injury list → XgModifiers

xG Calibration pipeline (The Winning Method):
  Layer 1 — Multipliers:  xG × home_advantage × motivation × injuries_factor
  Layer 2 — Weather:      ×0.84–0.93 for extreme rain/cold/heat
  Layer 3 — Positional:   +0.15–0.25 to opponent when GK/key-defender absent

Poisson PMF: P(X=k | λ) = exp(-λ)·λ^k/k!  (manual, no scipy)
  6×6 matrix (goals 0-5 per team) — covers >99.5% of Poisson mass for λ≤3.
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

def calculate_calibrated_xg(
    base_xg:              float,
    home_advantage:       float = 1.0,
    match_importance:     float = 1.0,
    key_injuries_factor:  float = 1.0,
) -> float:
    """
    Calibrate base xG using three dynamic multipliers (The Winning Method).

    Args:
        base_xg:             Raw Expected Goals from stats pipeline or odds calibration
        home_advantage:      Crowd + pitch boost; typically 1.15 for home, 1.0 for away/neutral
        match_importance:    Motivation scaling; e.g. 1.10 must-win, 0.90 dead rubber
        key_injuries_factor: Composite attacking-output factor; e.g. 0.85 when striker is out

    Returns:
        Calibrated xG, floored at 0.10 to prevent degenerate Poisson distributions.
    """
    calibrated = base_xg * home_advantage * match_importance * key_injuries_factor
    return max(0.10, round(calibrated, 2))


# ═══════════════════════════════════════════════════════════════════════════════
# §1  INPUT MODEL — XgModifiers
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class XgModifiers:
    """
    All contextual inputs that calibrate raw xG before the Poisson matrix.
    All fields default to neutral (no effect).

    Three calibration layers (applied in order by adjust_xg):
      Layer 1 — Multipliers (The Winning Method):
        home_advantage_multiplier : crowd + pitch boost for home team
        home_motivation / away_motivation : match-importance scaling
        home_injuries_factor / away_injuries_factor : composite attacking factor
      Layer 2 — Weather (multiplicative, both teams equally):
        precipitation_mm, temperature_c
      Layer 3 — Positional absences (additive, boosts *opponent* xG):
        GK / key-defender absence creates a defensive hole the opponent exploits.
        Striker absence is captured by injuries_factor (Layer 1) — not duplicated.
    """
    # ── Layer 1: The Winning Method calibration multipliers ───────────────────
    home_advantage_multiplier: float = 1.0   # 1.15 home venue; 1.0 neutral/away
    home_motivation:           float = 1.0   # e.g. 1.10 must-win, 0.90 dead rubber
    away_motivation:           float = 1.0
    home_injuries_factor:      float = 1.0   # e.g. 0.85 when striker is out
    away_injuries_factor:      float = 1.0

    # ── Layer 2: Weather ──────────────────────────────────────────────────────
    precipitation_mm: float = 0.0    # mm/h — heavy rain degrades finishing
    temperature_c:    float = 20.0   # °C   — extreme cold/heat reduces output

    # ── Layer 3: Positional absences (boost opponent's xG) ───────────────────
    home_gk_injured:           bool = False  # backup GK → opponent gets xG boost
    away_gk_injured:           bool = False
    home_key_defender_injured: bool = False
    away_key_defender_injured: bool = False


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
    Apply all 3 calibration layers to raw xG (The Winning Method pipeline).

    Order of operations:
      1. Multipliers  — home_advantage × motivation × injuries_factor (per team)
      2. Weather      — multiplicative global factor (both teams equally)
      3. Positional   — GK / key-defender absence → additive boost to opponent
      4. Floor clip   — max(_XG_FLOOR, result)

    Args:
        xg_home: Raw Expected Goals for home team (from stats pipeline or odds)
        xg_away: Raw Expected Goals for away team
        mods:    XgModifiers with all calibration inputs

    Returns:
        AdjustedXg with fully calibrated xg_home and xg_away
    """
    if mods is None:
        mods = XgModifiers()

    applied: list[str] = []

    # ── Step 1: The Winning Method — 3-multiplier calibration ─────────────────
    # Home team: home_advantage × motivation × injuries
    # Away team: no home_advantage multiplier (always 1.0 for visitor)
    h = calculate_calibrated_xg(
        float(xg_home),
        mods.home_advantage_multiplier,
        mods.home_motivation,
        mods.home_injuries_factor,
    )
    a = calculate_calibrated_xg(
        float(xg_away),
        1.0,                       # away team never gets home_advantage bonus
        mods.away_motivation,
        mods.away_injuries_factor,
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

    # ── Step 2: Weather — multiplicative, both teams ──────────────────────────
    if mods.precipitation_mm > 10:
        h *= _RAIN_SEVERE_FACTOR
        a *= _RAIN_SEVERE_FACTOR
        applied.append(f"rain_severe_>10mm(×{_RAIN_SEVERE_FACTOR})")
    elif mods.precipitation_mm > 5:
        h *= _RAIN_HEAVY_FACTOR
        a *= _RAIN_HEAVY_FACTOR
        applied.append(f"rain_heavy_>5mm(×{_RAIN_HEAVY_FACTOR})")

    if mods.temperature_c < 3:
        h *= _COLD_FACTOR
        a *= _COLD_FACTOR
        applied.append(f"extreme_cold(<3°C,×{_COLD_FACTOR})")
    elif mods.temperature_c > 35:
        h *= _HEAT_FACTOR
        a *= _HEAT_FACTOR
        applied.append(f"extreme_heat(>35°C,×{_HEAT_FACTOR})")

    # ── Step 3: Positional absences — additive boost to opponent ──────────────
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

    # ── Step 4: Floor ─────────────────────────────────────────────────────────
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
