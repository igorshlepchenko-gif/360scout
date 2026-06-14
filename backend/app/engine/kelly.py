"""
360SCOUT — Kelly Criterion Risk Manager

מחשב את גודל ההימור האופטימלי מהקופה לכל Value Bet.

נוסחת קלי:  f* = (b×p − q) / b
  b = odds − 1   (רווח נטו לכל יחידה)
  p = הסתברות ריאלית (מהמודל)
  q = 1 − p

בפועל משתמשים ב-Quarter-Kelly (×0.25) כדי לצמצם תנודתיות,
ומגבילים ל-MAX_BET_PCT מהקופה למניעת over-exposure.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class KellyResult:
    our_prob:       float           # הסתברות ריאלית (מהמודל)
    bookie_odds:    float           # יחס הסוכן
    full_kelly:     float           # Kelly מלא (שבר מהקופה)
    quarter_kelly:  float           # ×0.25 — גודל הימור מומלץ
    bet_size:       float           # ₪ בפועל (אחרי cap)
    bankroll:       float           # הקופה הנוכחית
    edge_pct:       float           # EV% = (p×odds−1)×100
    verdict:        Literal["BET", "SKIP"]
    reason:         str


_QUARTER = 0.25          # מקדם בטיחות — מקובל לטיפוס
_MAX_BET_PCT = 0.05      # תקרה: לעולם לא יותר מ-5% מהקופה


def kelly_criterion(
    bankroll:    float,
    our_prob:    float,
    bookie_odds: float,
    fraction:    float = _QUARTER,
    max_pct:     float = _MAX_BET_PCT,
) -> KellyResult:
    """
    מחשב גודל הימור אופטימלי לפי Kelly.

    Args:
        bankroll:    קופה נוכחית (₪)
        our_prob:    הסתברות ריאלית של המודל (0–1)
        bookie_odds: יחס עשרוני של הסוכן (למשל 2.50)
        fraction:    מקדם בטיחות (ברירת מחדל: 0.25 = Quarter-Kelly)
        max_pct:     תקרת חשיפה מקסימלית כשבר מהקופה (ברירת מחדל: 5%)

    Returns:
        KellyResult עם המלצת BET/SKIP ומידות.
    """
    if bankroll <= 0:
        return _no_bet(bankroll, our_prob, bookie_odds, "Bankroll must be > 0")
    if not (0 < our_prob < 1):
        return _no_bet(bankroll, our_prob, bookie_odds, "our_prob must be in (0, 1)")
    if bookie_odds <= 1.0:
        return _no_bet(bankroll, our_prob, bookie_odds, "Odds must be > 1.0")

    b = bookie_odds - 1          # רווח נטו לכל יחידה
    q = 1.0 - our_prob
    edge_pct = (our_prob * bookie_odds - 1) * 100

    # Kelly שלילי = אין ערך, אסור להמר
    full_kelly = (b * our_prob - q) / b
    if full_kelly <= 0:
        return _no_bet(
            bankroll, our_prob, bookie_odds,
            f"Negative Kelly ({full_kelly:.3f}) — no edge",
            edge_pct=edge_pct,
        )

    quarter_kelly = full_kelly * fraction
    raw_bet       = quarter_kelly * bankroll
    bet_size      = min(raw_bet, bankroll * max_pct)   # cap ב-5%

    reason = (
        f"Kelly={full_kelly*100:.1f}% → ×{fraction} → {quarter_kelly*100:.1f}%"
        + (f" (capped at {max_pct*100:.0f}%)" if raw_bet > bankroll * max_pct else "")
    )

    return KellyResult(
        our_prob=round(our_prob, 4),
        bookie_odds=bookie_odds,
        full_kelly=round(full_kelly, 4),
        quarter_kelly=round(quarter_kelly, 4),
        bet_size=round(bet_size, 2),
        bankroll=bankroll,
        edge_pct=round(edge_pct, 2),
        verdict="BET",
        reason=reason,
    )


def _no_bet(
    bankroll: float,
    our_prob: float,
    bookie_odds: float,
    reason: str,
    edge_pct: float = 0.0,
) -> KellyResult:
    return KellyResult(
        our_prob=our_prob,
        bookie_odds=bookie_odds,
        full_kelly=0.0,
        quarter_kelly=0.0,
        bet_size=0.0,
        bankroll=bankroll,
        edge_pct=round(edge_pct, 2),
        verdict="SKIP",
        reason=reason,
    )
