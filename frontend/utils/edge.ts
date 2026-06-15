/**
 * The Winning Method — Edge Calculation
 * edge = (modelProbability × marketOdds − 1) × 100
 *
 * Returns null for invalid/stale odds (edge > 100% = reversed odds).
 */

const MAX_VALID_EDGE = 100; // מעל זה → יחס הפוך/לא עדכני → דחה

export function calculateEdge(
  modelProbability: number,
  marketOdds: number,
): number | null {
  if (modelProbability <= 0 || modelProbability > 1) return null;
  if (marketOdds <= 1) return null;

  const edge = (modelProbability * marketOdds - 1) * 100;

  if (edge > MAX_VALID_EDGE) return null; // יחס לא תקין

  return parseFloat(edge.toFixed(1));
}

/** formatEdge(0.281, 6.09) → "+71.1%" */
export function formatEdge(
  modelProbability: number,
  marketOdds: number,
): string {
  const edge = calculateEdge(modelProbability, marketOdds);
  if (edge === null) return '—';
  return edge >= 0 ? `+${edge}%` : `${edge}%`;
}

/** isValueBet: edge >= threshold (default 5%) */
export function isValueBet(
  modelProbability: number,
  marketOdds: number,
  minEdge = 5,
): boolean {
  const edge = calculateEdge(modelProbability, marketOdds);
  return edge !== null && edge >= minEdge;
}
