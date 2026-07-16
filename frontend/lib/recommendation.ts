/**
 * Shared "single clear recommendation" logic — used by both MatchCard (static)
 * and MatchLiveRow (polling) so the dashboard and the Live tab always agree,
 * instead of the Live tab picking its own "highest raw probability" outcome.
 *
 * Source of truth is the backend's get_recommendation() (prediction_model.py) —
 * this only translates that object into a clean Hebrew display, it does not
 * re-derive the pick itself.
 */

export interface RecommendationData {
  recommendation: string;
  outcome?: "home" | "draw" | "away" | null;
  status:   string;   // "APPROVED" | "DRAW_VALUE" | "DOUBLE_CHANCE" | "FILTERED_SYMMETRIC"
  draw_prob?: number;
  prob?:      number;
  edge?:      number | null;
  reason?:    string;
}

export interface RecommendationDisplay {
  sign:   string;                        // "1" | "X" | "2" | "1X" | "X2" | "—"
  label:  string;                        // Hebrew headline
  detail: string;                        // Hebrew sub-line
  tone:   "pick" | "caution" | "neutral";
  edge:   number | null;
  key:    string;                        // stable identity for change-detection ("APPROVED:home" etc.)
}

export function describeRecommendation(
  rec: RecommendationData | null | undefined,
  homeTeam: string,
  awayTeam: string,
): RecommendationDisplay {
  if (!rec) {
    return { sign: "—", label: "אין נתוני המלצה", detail: "", tone: "neutral", edge: null, key: "none" };
  }

  const key = `${rec.status}:${rec.outcome ?? ""}`;

  switch (rec.status) {
    case "APPROVED": {
      const isDraw = rec.outcome === "draw";
      const isHome = rec.outcome === "home";
      const sign   = isDraw ? "X" : isHome ? "1" : "2";
      const label  = isDraw ? "תיקו (X)" : `ניצחון ${isHome ? "בית" : "חוץ"} — ${isHome ? homeTeam : awayTeam}`;
      const pct    = rec.prob != null ? `${Math.round(rec.prob * 100)}% הסתברות` : "";
      const edgeTxt = rec.edge != null ? ` · ערך ${rec.edge >= 0 ? "+" : ""}${rec.edge.toFixed(1)}%` : "";
      return { sign, label, detail: `${pct}${edgeTxt}`, tone: "pick", edge: rec.edge ?? null, key };
    }
    case "DRAW_VALUE": {
      const pct = rec.draw_prob != null ? `${Math.round(rec.draw_prob * 100)}% הסתברות` : "";
      const edgeTxt = rec.edge != null ? ` · ערך +${rec.edge.toFixed(1)}%` : "";
      return { sign: "X", label: "תיקו — ערך מיוחד בשוק", detail: `${pct}${edgeTxt}`, tone: "pick", edge: rec.edge ?? null, key };
    }
    case "DOUBLE_CHANCE": {
      const isHomeSide = rec.recommendation.includes("1X");
      const sign  = isHomeSide ? "1X" : "X2";
      const label = isHomeSide
        ? `ביטוח כפול 1X — ${homeTeam} או תיקו`
        : `ביטוח כפול X2 — תיקו או ${awayTeam}`;
      const detail = rec.draw_prob != null ? `סיכון תיקו ${Math.round(rec.draw_prob * 100)}% — נמנעים מפיק ישיר` : "";
      return { sign, label, detail, tone: "caution", edge: null, key };
    }
    case "FILTERED_SYMMETRIC":
      return {
        sign: "—", label: "אין המלצה ברורה", detail: "סיכון תיקו סימטרי — אין כיוון ברור כרגע",
        tone: "neutral", edge: null, key,
      };
    default:
      return { sign: "—", label: rec.recommendation || "אין המלצה", detail: "", tone: "neutral", edge: rec.edge ?? null, key };
  }
}
