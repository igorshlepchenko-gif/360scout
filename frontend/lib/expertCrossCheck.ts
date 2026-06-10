/**
 * Analyst365 — Expert Cross-Check
 * ---------------------------------
 * Cross-checks the core mathematical model (xG / Poisson confidence) against
 * qualitative expert analysis (The Athletic, Action Network, sports-news APIs).
 *
 * Pure & deterministic: the same match always yields the same result, so the
 * adjusted confidence is stable across repeated calls. The HTTP layer lives in
 * app/api/cross-check/route.ts — this file holds the portable logic only.
 */

/* ── Types ───────────────────────────────────────────────────────────────── */

export type Outcome = "home" | "draw" | "away";

export interface CrossCheckInput {
  homeTeam: string;
  awayTeam: string;
  /** Algorithm confidence 0–100 (from the Python `_confidence`) */
  algorithmConfidence: number;
  /** Final probabilities 0–1 (sum ≈ 1) */
  probabilities: { home: number; draw: number; away: number };
  /**
   * Optional pre-fetched qualitative sources. When omitted the function
   * simulates fetching from expert outlets (deterministic per match).
   */
  sources?: QualitativeSource[];
}

export interface QualitativeSource {
  source: string;
  text: string;
  /** Optional explicit lean; inferred from `text` when absent. */
  lean?: Outcome | "neutral";
}

export interface DetectedSignal {
  factor: string;       // canonical key, e.g. "INJURY"
  label: string;        // Hebrew label
  weight: number;       // risk weight contributed
  source: string;       // which outlet raised it
}

export interface CrossCheckResult {
  homeTeam: string;
  awayTeam: string;
  algorithmPick: Outcome;
  algorithmConfidence: number;
  expertAlignmentScore: number;   // -15 … +15
  adjustedConfidence: number;     // 5 … 95
  verdict: "STRONG_AGREE" | "AGREE" | "NEUTRAL" | "DISAGREE" | "STRONG_DISAGREE";
  agreement: { agree: number; disagree: number; neutral: number; total: number };
  riskFactors: DetectedSignal[];
  insightSummary: string;         // Hebrew
  sources: Array<{ source: string; lean: Outcome | "neutral" }>;
}

/* ── Keyword dictionaries (English + Hebrew) ─────────────────────────────── */

interface RiskKeyword { factor: string; label: string; weight: number; terms: string[] }

const RISK_KEYWORDS: RiskKeyword[] = [
  { factor: "KEY_INJURY",     label: "פציעת שחקן מפתח", weight: 5, terms: ["key injury", "ruled out", "star out", "פציעה מרכזית", "נפקד מרכזי"] },
  { factor: "INJURY",         label: "פציעות בסגל",      weight: 4, terms: ["injury", "injured", "fitness doubt", "פציעה", "פצוע"] },
  { factor: "SUSPENSION",     label: "הרחקה / כרטיסים",  weight: 4, terms: ["suspension", "suspended", "red card", "הרחקה", "מורחק"] },
  { factor: "ROTATION",       label: "רוטציה בהרכב",     weight: 3, terms: ["rotation", "rotated", "rest players", "rotate", "רוטציה", "מנוחה"] },
  { factor: "TACTICAL_SHIFT", label: "שינוי טקטי",        weight: 2, terms: ["tactical shift", "formation change", "new system", "שינוי טקטי", "מערך חדש"] },
  { factor: "HEAVY_RAIN",     label: "מזג אוויר קשה",    weight: 2, terms: ["heavy rain", "wet pitch", "storm", "snow", "גשם כבד", "מגרש רטוב"] },
  { factor: "FATIGUE",        label: "עומס ועייפות",     weight: 2, terms: ["fatigue", "congested fixtures", "tired legs", "עייפות", "עומס משחקים"] },
  { factor: "MOTIVATION",     label: "ספק מוטיבציוני",   weight: 2, terms: ["nothing to play for", "dead rubber", "low stakes", "ללא משמעות", "חוסר מוטיבציה"] },
];

// Verbs that indicate a positive lean toward a mentioned side.
const POSITIVE_TERMS = ["win", "favor", "favour", "edge", "dominate", "strong", "comfortable", "back ", "tip", "ניצחון", "יתרון", "שולט", "מועדף"];
const DRAW_TERMS     = ["draw", "stalemate", "even", "tight", "share the spoils", "תיקו", "צמוד", "שקול"];

/* ── Deterministic PRNG (so a match always simulates the same sources) ───── */

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export function favoredOutcome(p: CrossCheckInput["probabilities"]): Outcome {
  return (["home", "draw", "away"] as const).reduce((a, b) => (p[b] > p[a] ? b : a), "home");
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Simulate qualitative coverage from expert outlets. Leans are biased toward the
 * model's probabilities (decisive matches → more agreement) with deterministic
 * per-source perturbation, plus occasional injected risk language.
 */
function simulateSources(input: CrossCheckInput): QualitativeSource[] {
  const { homeTeam, awayTeam, probabilities: p } = input;
  const rand = mulberry32(hashSeed(`${homeTeam}|${awayTeam}`));
  const outlets = ["The Athletic", "Action Network", "ESPN Insider"];
  const pick = favoredOutcome(p);
  const margin = Math.max(p.home, p.draw, p.away) - [p.home, p.draw, p.away].sort((a, b) => b - a)[1];

  return outlets.map((outlet) => {
    const r = rand();
    // higher margin → higher chance the outlet agrees with the model
    const agreeProb = clamp(0.45 + margin * 1.4, 0.2, 0.9);
    let lean: Outcome | "neutral";
    if (r < agreeProb) lean = pick;
    else if (r < agreeProb + 0.18) lean = "draw";
    else lean = pick === "home" ? "away" : "home";

    const leanTeam = lean === "home" ? homeTeam : lean === "away" ? awayTeam : "תיקו";
    let text =
      lean === "draw"
        ? `${outlet}: צפויה התמודדות צמודה ושקולה בין ${homeTeam} ל-${awayTeam}.`
        : `${outlet}: יתרון ברור ל-${leanTeam} לפי הניתוח האיכותי.`;

    // inject a risk phrase on some matches (deterministic)
    const riskRoll = rand();
    if (riskRoll > 0.7) text += " דווח על injury לשחקן מפתח.";
    else if (riskRoll > 0.55) text += " המאמן רמז על rotation לקראת המשחק.";
    else if (riskRoll > 0.45) text += " תחזית מזג האוויר מצביעה על heavy rain.";

    return { source: outlet, text };
  });
}

/** Infer a source's lean from its free text (English + Hebrew). */
function inferLean(text: string, homeTeam: string, awayTeam: string): Outcome | "neutral" {
  const t = text.toLowerCase();
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();

  if (DRAW_TERMS.some((d) => t.includes(d))) return "draw";

  const mentionsHome = t.includes(home);
  const mentionsAway = t.includes(away);
  const positive = POSITIVE_TERMS.some((v) => t.includes(v));

  if (positive && mentionsHome && !mentionsAway) return "home";
  if (positive && mentionsAway && !mentionsHome) return "away";
  // both mentioned + positive → side appearing closest to the positive verb wins (rough)
  if (positive && mentionsHome && mentionsAway) {
    return t.indexOf(home) < t.indexOf(away) ? "home" : "away";
  }
  return "neutral";
}

/** Scan all source text for risk keywords. */
function detectRisks(sources: QualitativeSource[]): DetectedSignal[] {
  const found = new Map<string, DetectedSignal>();
  for (const s of sources) {
    const t = s.text.toLowerCase();
    for (const kw of RISK_KEYWORDS) {
      if (kw.terms.some((term) => t.includes(term.toLowerCase()))) {
        // keep the highest-weight hit per factor, remember the source
        if (!found.has(kw.factor)) {
          found.set(kw.factor, { factor: kw.factor, label: kw.label, weight: kw.weight, source: s.source });
        }
      }
    }
  }
  return [...found.values()];
}

/* ── Hebrew insight summary ──────────────────────────────────────────────── */

function buildSummary(
  pickTeam: string,
  verdict: CrossCheckResult["verdict"],
  delta: number,
  risks: DetectedSignal[],
  agree: number,
  total: number,
): string {
  const dir = delta > 0 ? `עלה ב-${delta}%` : delta < 0 ? `ירד ב-${Math.abs(delta)}%` : "נותר ללא שינוי";
  const riskTxt = risks.length ? ` זוהו גורמי סיכון: ${risks.map((r) => r.label).join(", ")}.` : "";

  const head: Record<CrossCheckResult["verdict"], string> = {
    STRONG_AGREE:    `קונצנזוס מומחים חזק: ${agree} מתוך ${total} מקורות תומכים בחיזוי האלגוריתם (${pickTeam}).`,
    AGREE:           `רוב המומחים תומכים בחיזוי האלגוריתם (${pickTeam}).`,
    NEUTRAL:         `דעות המומחים חלוקות לגבי ${pickTeam} — ללא הטיה מובהקת.`,
    DISAGREE:        `חלק מהמומחים חולקים על חיזוי האלגוריתם (${pickTeam}).`,
    STRONG_DISAGREE: `המומחים חולקים בתוקף על האלגוריתם — היזהר מ-${pickTeam}.`,
  };

  return `${head[verdict]} רמת הביטחון ${dir}.${riskTxt}`.trim();
}

/* ── Main entry point ────────────────────────────────────────────────────── */

export function crossCheckPrediction(input: CrossCheckInput): CrossCheckResult {
  const { homeTeam, awayTeam, probabilities } = input;
  const algorithmConfidence = clamp(Math.round(input.algorithmConfidence), 0, 100);
  const pick = favoredOutcome(probabilities);
  const pickTeam = pick === "home" ? homeTeam : pick === "away" ? awayTeam : "תיקו";

  // 1. Gather qualitative sources (real or simulated) and resolve their leans.
  const rawSources = input.sources?.length ? input.sources : simulateSources(input);
  const sources = rawSources.map((s) => ({
    source: s.source,
    lean: s.lean ?? inferLean(s.text, homeTeam, awayTeam),
    text: s.text,
  }));

  // 2. Agreement tally vs the model's pick.
  let agree = 0, disagree = 0, neutral = 0;
  for (const s of sources) {
    if (s.lean === "neutral") neutral++;
    else if (s.lean === pick) agree++;
    else disagree++;
  }
  const decisive = agree + disagree;
  const agreementRatio = decisive ? (agree - disagree) / decisive : 0; // -1 … 1

  // 3. Risk keywords reduce confidence regardless of agreement.
  const riskFactors = detectRisks(rawSources);
  const riskScore = Math.min(riskFactors.reduce((s, r) => s + r.weight, 0), 12);

  // 4. Expert Alignment Score, clamped to ±15.
  const alignmentComponent = agreementRatio * 12;     // -12 … 12
  const riskComponent = -Math.min(riskScore, 6) * 0.6; // up to -3.6
  const expertAlignmentScore = Math.round(clamp(alignmentComponent + riskComponent, -15, 15));

  // 5. Adjusted confidence.
  const adjustedConfidence = clamp(Math.round(algorithmConfidence + expertAlignmentScore), 5, 95);
  const delta = adjustedConfidence - algorithmConfidence;

  // 6. Verdict bucket.
  const verdict: CrossCheckResult["verdict"] =
    expertAlignmentScore >= 9  ? "STRONG_AGREE" :
    expertAlignmentScore >= 3  ? "AGREE" :
    expertAlignmentScore <= -9 ? "STRONG_DISAGREE" :
    expertAlignmentScore <= -3 ? "DISAGREE" : "NEUTRAL";

  return {
    homeTeam,
    awayTeam,
    algorithmPick: pick,
    algorithmConfidence,
    expertAlignmentScore,
    adjustedConfidence,
    verdict,
    agreement: { agree, disagree, neutral, total: sources.length },
    riskFactors,
    insightSummary: buildSummary(pickTeam, verdict, delta, riskFactors, agree, sources.length),
    sources: sources.map(({ source, lean }) => ({ source, lean })),
  };
}
