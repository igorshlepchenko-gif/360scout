"use client";
import { Play, TrendingUp, Zap, Clock } from "lucide-react";

/* ── Types — the real /api/live/matches shape ───────────────────────────── */
interface LiveMatch {
  fixture_id: number;
  home_team: string;
  away_team: string;
  league?: string;
  _status?: string;
  elapsed?: number | null;
  status_short?: string | null;
  score?: { home: number | null; away: number | null } | null;
  prediction?: { final: { home: number; draw: number; away: number }; confidence: number };
  value_bets?: Record<string, { is_value_bet: boolean; edge_percent: number; rating: string; bookmaker_odds: number }> | null;
}

const OUTCOME_HE: Record<string, string> = { home: "ניצחון בית (1)", draw: "תיקו (X)", away: "ניצחון חוץ (2)" };

export default function LiveInPlayTab({ matches = [] }: { matches?: LiveMatch[] }) {
  // only matches that are actually in play right now
  const live = matches.filter(m => m._status === "live");

  return (
    <div className="mt-10 w-full">

      {/* ── Header banner ── */}
      <div className="mb-6 flex items-center gap-4 rounded-xl border border-red-500/20 p-4"
        style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.06), rgba(245,158,11,0.06))" }}>
        <div className="flex shrink-0 animate-pulse items-center gap-2 rounded bg-red-500 px-2.5 py-1 text-xs font-bold text-black">
          <Play size={10} fill="currentColor" />
          LIVE
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">משחקים בליין רץ (In-Play)</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            משחקים שמתנהלים ברגעים אלה — תוצאה, דקה והשוואת המודל מול יחסי השוק שנמדדו.
          </p>
        </div>
        <span className="mr-auto rounded-full bg-red-500/10 px-2.5 py-1 font-mono text-xs font-bold text-red-400">
          {live.length} חיים כרגע
        </span>
      </div>

      {/* ── Empty state — honest ── */}
      {live.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#0F1318] py-10 text-center">
          <div className="mb-2 text-2xl">⏱️</div>
          <div className="text-sm text-slate-400">אין משחקים חיים ברגע זה</div>
          <div className="mt-1 text-xs text-slate-600">
            ברגע שמשחק מנוטר ייכנס לליין הרץ — הוא יופיע כאן עם הדקה והתוצאה בזמן אמת
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {live.map(m => {
            const final  = m.prediction?.final;
            const topKey = final
              ? (Object.entries(final).sort((a, b) => b[1] - a[1])[0][0] as "home" | "draw" | "away")
              : null;
            const vbEntry = Object.entries(m.value_bets ?? {}).find(([, v]) => v?.is_value_bet);
            const fairOdds = topKey && final ? (1 / final[topKey]).toFixed(2) : null;
            const scoreTxt = m.score && m.score.home !== null
              ? `${m.score.home} - ${m.score.away}`
              : "0 - 0";
            const timeTxt = m.status_short === "HT" ? "מחצית" : m.elapsed ? `${m.elapsed}'` : "LIVE";

            return (
              <div key={m.fixture_id}
                className="overflow-hidden rounded-xl border border-slate-800 transition-all hover:border-slate-700"
                style={{ background: "#0F1318" }}>

                {/* match header */}
                <div className="flex items-center justify-between border-b border-slate-800/60 px-4 py-2.5 text-xs"
                  style={{ background: "rgba(0,0,0,0.25)" }}>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 font-mono font-bold text-red-400">
                      <Clock size={12} />
                      {timeTxt}
                    </span>
                    <span className="text-slate-600">|</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono font-bold text-slate-300" dir="ltr">
                      {scoreTxt}
                    </span>
                    <span className="mr-2 font-medium text-slate-200" style={{ direction: "ltr" }}>
                      {m.home_team} vs {m.away_team}
                    </span>
                  </div>
                  {m.league && <span className="text-[11px] text-slate-500">{m.league}</span>}
                </div>

                {/* value details */}
                <div className="grid grid-cols-1 items-center gap-4 p-4 text-xs md:grid-cols-4">

                  {/* model pick */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500">בחירת המודל (טרום-משחק)</span>
                    <span className="flex items-center gap-1 text-sm font-bold text-slate-200">
                      <Zap size={14} className="fill-amber-400 text-amber-400" />
                      {topKey ? OUTCOME_HE[topKey] : "—"}
                      {topKey && final && (
                        <span className="font-mono text-[11px] text-slate-500">({Math.round(final[topKey] * 100)}%)</span>
                      )}
                    </span>
                  </div>

                  {/* odds comparison — only with real market data */}
                  {vbEntry ? (
                    <div className="flex justify-around rounded-lg border border-slate-800 p-2 text-center font-mono"
                      style={{ background: "rgba(0,0,0,0.3)" }}>
                      <div>
                        <span className="block text-[10px] text-slate-500">יחס בוקמייקר</span>
                        <span className="text-sm font-bold text-slate-200">{vbEntry[1].bookmaker_odds?.toFixed(2)}</span>
                      </div>
                      <div className="my-1 w-px bg-slate-800" />
                      <div>
                        <span className="block text-[10px] text-slate-500">יחס הוגן (מודל)</span>
                        <span className="text-sm font-semibold text-slate-400">{fairOdds ?? "—"}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-800/60 p-2 text-center text-[11px] text-slate-600"
                      style={{ background: "rgba(0,0,0,0.2)" }}>
                      אין יחסי שוק זמינים למשחק זה
                    </div>
                  )}

                  {/* edge badge */}
                  <div className="text-right md:text-center">
                    <span className="mb-0.5 block text-[10px] text-slate-500">יתרון ערך (Edge)</span>
                    {vbEntry ? (
                      <span className="inline-block rounded bg-emerald-500/10 px-3 py-1 font-mono text-sm font-bold text-emerald-400">
                        +{vbEntry[1].edge_percent.toFixed(1)}% Value
                      </span>
                    ) : (
                      <span className="inline-block rounded bg-slate-800/60 px-3 py-1 font-mono text-sm text-slate-600">—</span>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="flex justify-end">
                    <a
                      href="https://t.me/Malmilyan"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-black shadow-lg shadow-red-500/10 transition-colors hover:bg-red-600 md:w-auto"
                    >
                      <TrendingUp size={14} />
                      קבל התראות לייב בטלגרם
                    </a>
                  </div>
                </div>
              </div>
            );
          })}

          <p className="text-center text-[10px] text-slate-600">
            היחס ההוגן מבוסס על מודל טרום-משחק — אינו מתעדכן לפי מהלך המשחק. למטרות מחקר בלבד.
          </p>
        </div>
      )}
    </div>
  );
}
