"use client";

import { Users, ShieldCheck } from "lucide-react";

/* ── Real data shapes (analysts page / API) ─────────────────────────────── */
export interface AnalystPredictionRow {
  analyst_id: string;
  name: string;
  predicted_outcome: string;     // "home" | "draw" | "away"
  confidence_level: number;      // 1–10
  reasoning?: string;
  win_rate: number;
}

interface MatchConsensusProps {
  homeTeam: string;
  awayTeam: string;
  /** prediction.final + confidence מהמשחק הנבחר */
  algoProbs: { home: number; draw: number; away: number };
  algoConfidence: number;
  analysts: AnalystPredictionRow[];
}

const SIGN_12X:  Record<string, string> = { home: "1", draw: "X", away: "2" };
const OUTCOME_HE: Record<string, string> = { home: "בית", draw: "תיקו", away: "חוץ" };

export default function MatchConsensus({
  homeTeam, awayTeam, algoProbs, algoConfidence, analysts,
}: MatchConsensusProps) {
  // בחירת האלגוריתם — ההסתברות הגבוהה ביותר
  const algoPick = (Object.entries(algoProbs) as [string, number][])
    .sort((a, b) => b[1] - a[1])[0][0];
  const algoPickTeam = algoPick === "home" ? homeTeam : algoPick === "away" ? awayTeam : "תיקו";

  // קונסנזוס — כמה מסכימים עם האלגוריתם
  const agreeing = analysts.filter(a => a.predicted_outcome === algoPick);
  const consensusPct = analysts.length
    ? Math.round((agreeing.length / analysts.length) * 100)
    : 0;

  // נעילה — אותו כלל כמו ה-backend (get_consensus_locks): רוב מסכים
  const isConsensusLock = analysts.length > 0 && agreeing.length * 2 > analysts.length;

  return (
    <div dir="rtl" className="w-full rounded-xl border border-slate-800 bg-[#0F1318] p-5 text-white">

      {/* כותרת + סטטוס נעילה */}
      <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-sky-400" />
          <h3 className="m-0 text-base font-bold">הצלבת אנליסטים וקונסנזוס</h3>
        </div>
        {isConsensusLock && (
          <span className="flex animate-pulse items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
            <ShieldCheck className="h-4 w-4" />
            נעילת קונסנזוס פעילה
          </span>
        )}
      </div>

      {/* The Winning Method — השוואה מרוכזת */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-white/[0.03] p-3">
          <span className="mb-1 block text-xs text-slate-400">🤖 ניבוי אלגוריתם</span>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {algoPickTeam} [ {SIGN_12X[algoPick]} ]
            </span>
            <span className="font-bold text-emerald-400">{Math.round(algoConfidence)}% ביטחון</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-white/[0.03] p-3">
          <span className="mb-1 block text-xs text-slate-400">📊 הסכמת אנליסטים</span>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {agreeing.length} מתוך {analysts.length} אנליסטים
            </span>
            <span className={`font-bold ${isConsensusLock ? "text-amber-400" : "text-sky-400"}`}>
              {consensusPct}% קונסנזוס
            </span>
          </div>
        </div>
      </div>

      {/* פירוט עמדות */}
      <div className="space-y-2">
        <span className="mb-2 block text-xs text-slate-400">פירוט עמדות אנליסטים:</span>
        {analysts.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-[#0B0E14] p-3 text-center text-xs text-slate-500">
            עדיין לא הוזנו ניבויי אנליסטים למשחק זה
          </div>
        ) : analysts.map(a => {
          const isAgreeing = a.predicted_outcome === algoPick;
          return (
            <div
              key={a.analyst_id + a.predicted_outcome}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B0E14] p-2.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-[10px] font-bold">
                  {a.name.charAt(0)}
                </div>
                <span className="font-medium">{a.name}</span>
                {a.reasoning && <span className="text-[10px] text-slate-600">· {a.reasoning}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded px-2 py-0.5 text-[11px] ${
                  isAgreeing ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-400"}`}>
                  בחירה: {OUTCOME_HE[a.predicted_outcome] ?? a.predicted_outcome} [ {SIGN_12X[a.predicted_outcome] ?? "?"} ]
                </span>
                <span className="text-slate-400">ביטחון: {a.confidence_level}/10</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
