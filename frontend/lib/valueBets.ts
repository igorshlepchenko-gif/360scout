/**
 * Value-bet selection helpers.
 *
 * חשוב: חישוב ה-Edge עצמו חי במקום אחד בלבד — ה-backend
 * (prediction_model.calculate_value: value = prob × odds − 1, סף 5%).
 * הקובץ הזה רק *בוחר* מתוך התוצאות שה-backend כבר חישב,
 * כדי שלא ייווצרו שני מקורות אמת עם ספים שונים.
 */

export interface ValueBetEntry {
  is_value_bet: boolean;
  edge_percent: number;
  rating: string;
  bookmaker_odds: number;
  value?: number;
}

export type ValueBetsMap = Partial<Record<"home" | "draw" | "away", ValueBetEntry | undefined>> | null | undefined;

export const OUTCOME_12X: Record<string, string> = { home: "1", draw: "X", away: "2" };

/**
 * ה-value bet עם ה-Edge הגבוה ביותר (לא הראשון שנמצא).
 * מחזיר null כשאין אף סימון.
 */
export function bestValueBet(valueBets: ValueBetsMap): [string, ValueBetEntry] | null {
  if (!valueBets) return null;
  let best: [string, ValueBetEntry] | null = null;
  for (const [outcome, vb] of Object.entries(valueBets)) {
    if (!vb?.is_value_bet) continue;
    if (!best || vb.edge_percent > best[1].edge_percent) best = [outcome, vb];
  }
  return best;
}

/** ה-Edge המקסימלי במשחק (0 כשאין) — למיון רשימות. */
export function maxEdge(valueBets: ValueBetsMap): number {
  if (!valueBets) return 0;
  return Math.max(0, ...Object.values(valueBets).map(v => (v?.is_value_bet ? v.edge_percent : 0)));
}
