/**
 * Frontend value-bet calculator.
 *
 * אלגוריתם זהה לbackend: edge = algo_prob − (1/market_odds)
 * ספף: 5% (VALUE_THRESHOLD = 0.05)
 *
 * זה helper לתצוגה בלבד — מקור האמת הוא ה-backend.
 * השתמש ב-is_value_bet מה-API לאזהרות, כאן רק לפירוק ויזואלי.
 */

export interface AlgoProbs {
  home: number; // 0–1
  draw: number;
  away: number;
}

export interface MarketOdds {
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
  bookmaker?: string;
}

export interface OutcomeEdge {
  key: "home" | "draw" | "away";
  label12X: string;   // "1" | "X" | "2"
  labelHe: string;    // "בית" | "תיקו" | "חוץ"
  algoProb: number;   // 0–1
  impliedProb: number;
  edge: number;       // algoProb − impliedProb
  edgePct: number;    // ×100, 1 decimal
  marketOdds: number;
  fairOdds: string;   // "2.15" — (1/algoProb)
  isValue: boolean;
}

export interface ValueAnalysis {
  hasValue: boolean;
  best: OutcomeEdge | null;
  breakdown: OutcomeEdge[];
}

const VALUE_THRESHOLD = 0.05;

const LABELS: Record<string, [string, string]> = {
  home: ["1", "בית"],
  draw: ["X", "תיקו"],
  away: ["2", "חוץ"],
};

export function calculateValueBets(
  algoProbs: AlgoProbs,
  marketOdds: MarketOdds | null,
): ValueAnalysis {
  const empty: ValueAnalysis = { hasValue: false, best: null, breakdown: [] };
  if (!marketOdds || !marketOdds.homeOdds || !marketOdds.awayOdds) return empty;

  const pairs: [string, number, number][] = [
    ["home", algoProbs.home, marketOdds.homeOdds],
    ["draw", algoProbs.draw, marketOdds.drawOdds || 3.5],
    ["away", algoProbs.away, marketOdds.awayOdds],
  ];

  const breakdown: OutcomeEdge[] = pairs.map(([key, algoProb, mOdds]) => {
    const impliedProb = 1 / mOdds;
    const edge = algoProb - impliedProb;
    const edgePct = Math.round(edge * 1000) / 10;
    return {
      key: key as "home" | "draw" | "away",
      label12X: LABELS[key][0],
      labelHe:  LABELS[key][1],
      algoProb,
      impliedProb,
      edge,
      edgePct,
      marketOdds: mOdds,
      fairOdds: algoProb > 0 ? (1 / algoProb).toFixed(2) : "—",
      isValue: edge >= VALUE_THRESHOLD,
    };
  });

  const best = breakdown.reduce((a, b) => (a.edge > b.edge ? a : b));

  return {
    hasValue: best.isValue,
    best:     best.isValue ? best : null,
    breakdown,
  };
}

/** בנה MarketOdds מ-value_bets שמגיע מה-API */
export function marketOddsFromValueBets(
  valueBets: Record<string, { bookmaker_odds?: number }> | null | undefined,
): MarketOdds | null {
  if (!valueBets) return null;
  const h = valueBets.home?.bookmaker_odds;
  const a = valueBets.away?.bookmaker_odds;
  if (!h || !a) return null;
  return {
    homeOdds: h,
    drawOdds: valueBets.draw?.bookmaker_odds ?? 3.5,
    awayOdds: a,
  };
}
