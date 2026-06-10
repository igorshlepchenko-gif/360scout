/**
 * POST /api/cross-check
 * ----------------------
 * Cross-checks the core algorithm output against qualitative expert analysis
 * and returns an adjusted confidence + a Hebrew "Expert Insight" summary.
 *
 * Body (JSON):
 * {
 *   "homeTeam": "Real Madrid",
 *   "awayTeam": "Barcelona",
 *   "algorithmConfidence": 68,
 *   "probabilities": { "home": 0.52, "draw": 0.24, "away": 0.24 },
 *   "sources": [ { "source": "The Athletic", "text": "..." } ]   // optional
 * }
 *
 * If "sources" is omitted, expert coverage is simulated (deterministic per match).
 */

import { crossCheckPrediction, type CrossCheckInput } from "@/lib/expertCrossCheck";

function bad(message: string, status = 400) {
  return Response.json({ status: "error", message }, { status });
}

export async function POST(request: Request) {
  let body: Partial<CrossCheckInput>;
  try {
    body = await request.json();
  } catch {
    return bad("גוף הבקשה אינו JSON תקין");
  }

  // ── Validation ──────────────────────────────────────────────────────────
  const { homeTeam, awayTeam, algorithmConfidence, probabilities, sources } = body;

  if (typeof homeTeam !== "string" || typeof awayTeam !== "string" || !homeTeam || !awayTeam) {
    return bad("נדרשים homeTeam ו-awayTeam");
  }
  if (typeof algorithmConfidence !== "number" || Number.isNaN(algorithmConfidence)) {
    return bad("algorithmConfidence חייב להיות מספר (0–100)");
  }
  if (
    !probabilities ||
    typeof probabilities.home !== "number" ||
    typeof probabilities.draw !== "number" ||
    typeof probabilities.away !== "number"
  ) {
    return bad("probabilities חייב לכלול home/draw/away מספריים");
  }
  if (sources !== undefined && !Array.isArray(sources)) {
    return bad("sources חייב להיות מערך אם הוא מסופק");
  }

  // ── Cross-check ─────────────────────────────────────────────────────────
  try {
    const result = crossCheckPrediction({
      homeTeam,
      awayTeam,
      algorithmConfidence,
      probabilities,
      sources,
    });
    return Response.json({ status: "success", ...result });
  } catch (e) {
    return bad(`שגיאה בעיבוד הצלבת המומחים: ${(e as Error).message}`, 500);
  }
}

// Handy for a quick browser sanity check / docs.
export async function GET() {
  return Response.json({
    name: "Analyst365 Expert Cross-Check",
    method: "POST",
    body: {
      homeTeam: "string",
      awayTeam: "string",
      algorithmConfidence: "number (0–100)",
      probabilities: { home: "0–1", draw: "0–1", away: "0–1" },
      sources: "optional QualitativeSource[] — simulated if omitted",
    },
  });
}
