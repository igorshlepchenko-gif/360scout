"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ArrowUpRight, ArrowDownRight, CheckCircle2, MinusCircle, Clock3,
  Filter, Calendar, Zap, EyeOff,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const OUTCOME_HE:  Record<string, string> = { home: "ניצחון בית", draw: "תיקו", away: "ניצחון חוץ" };
const OUTCOME_12X: Record<string, string> = { home: "1", draw: "X", away: "2" };

// ── League tier classification ────────────────────────────────────────────────
// Tier 1: always visible, premium badge
// Tier 2: visible, secondary badge
// Tier 3: hidden by default — user must opt in
const TIER1_PATTERNS = [
  /world.?cup|fifa|מונדיאל/i,
  /champions.?league|ליגת האלופות/i,
  /premier.?league|פרמייר/i,
  /la.?liga|לה ליגה/i,
  /bundesliga|בונדסליגה/i,
  /serie.?a|סרייה א/i,
  /ligue.?1|ליג 1/i,
  /europa.?league|ליגה אירופית/i,
];
const TIER2_PATTERNS = [
  /mls/i,
  /brasileirao|ליגה ברזילאית/i,
  /eredivisie/i,
  /primeira/i,
];

function leagueTier(name: string | null): 1 | 2 | 3 {
  if (!name) return 2;
  if (TIER1_PATTERNS.some(p => p.test(name))) return 1;
  if (TIER2_PATTERNS.some(p => p.test(name))) return 2;
  return 3;
}

function isWorldCup(name: string | null): boolean {
  return /world.?cup|fifa|מונדיאל/i.test(name ?? "");
}

function LeagueBadge({ name }: { name: string | null }) {
  const tier = leagueTier(name);
  const wc   = isWorldCup(name);

  if (wc) return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      background: "rgba(245,158,11,.15)", color: "#f59e0b",
    }}>
      🏆 WC
    </span>
  );
  if (tier === 1) return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      background: "rgba(59,130,246,.12)", color: "#60a5fa",
    }}>
      ★ T1
    </span>
  );
  if (tier === 2) return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      background: "rgba(100,116,139,.12)", color: "#64748b",
    }}>
      T2
    </span>
  );
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      background: "rgba(51,65,85,.4)", color: "#475569",
    }}>
      T3
    </span>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────
interface TrackRow {
  home_team_name: string;
  away_team_name: string;
  league_name: string | null;
  match_date: string | null;
  fixture_id: number | null;
  predicted_outcome: string | null;
  actual_outcome: string | null;
  was_correct: boolean | null;
  value_bet_hit: boolean;
  odds_home: number | null;
  odds_draw: number | null;
  odds_away: number | null;
  final_prob_home: number | null;
  final_prob_draw: number | null;
  final_prob_away: number | null;
  confidence_score: number | null;
  status: "finished" | "pending";
}

interface Summary {
  total: number; correct: number; accuracy: number;
  value_bets: number; vb_correct: number; vb_accuracy: number;
  pending: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function pickOf(r: TrackRow): "home" | "draw" | "away" | null {
  if (r.predicted_outcome === "home" || r.predicted_outcome === "draw" || r.predicted_outcome === "away")
    return r.predicted_outcome;
  if (r.final_prob_home == null) return null;
  const probs = { home: r.final_prob_home ?? 0, draw: r.final_prob_draw ?? 0, away: r.final_prob_away ?? 0 };
  return (Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0]) as "home" | "draw" | "away";
}

function oddsOf(r: TrackRow): number | null {
  const p = pickOf(r);
  if (!p) return null;
  const o = p === "home" ? r.odds_home : p === "draw" ? r.odds_draw : r.odds_away;
  return o && o > 1 ? o : null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

type ResultFilter = "ALL" | "WON" | "LOST" | "PENDING" | "VALUE";

// ── Page ─────────────────────────────────────────────────────────────────────
export default function TrackRecordPage() {
  const [rows, setRows]         = useState<TrackRow[]>([]);
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<ResultFilter>("ALL");
  const [showTier3, setShowTier3] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/live/track-record?limit=100`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => { setRows(d.recent ?? []); setSummary(d.summary ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Profit stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const resolved = rows.filter(r => r.status === "finished" && r.was_correct !== null);
    const bets = resolved
      .map(r => ({ r, odds: oddsOf(r) }))
      .filter((b): b is { r: TrackRow; odds: number } => b.odds !== null);

    let units = 0;
    const cum: { date: string; units: number }[] = [];
    const sorted = [...bets].sort((a, b) =>
      new Date(a.r.match_date ?? 0).getTime() - new Date(b.r.match_date ?? 0).getTime());

    for (const b of sorted) {
      units += b.r.was_correct ? b.odds - 1 : -1;
      cum.push({ date: fmtDate(b.r.match_date), units: Math.round(units * 100) / 100 });
    }

    const avgOdds  = bets.length ? bets.reduce((s, b) => s + b.odds, 0) / bets.length : 0;
    const yieldPct = bets.length ? (units / bets.length) * 100 : 0;
    return {
      betCount: bets.length,
      units: Math.round(units * 100) / 100,
      yieldPct: Math.round(yieldPct * 10) / 10,
      avgOdds: Math.round(avgOdds * 100) / 100,
      chart: cum,
    };
  }, [rows]);

  // ── Tier filter + result filter ──────────────────────────────────────────
  const tierFiltered = useMemo(
    () => showTier3 ? rows : rows.filter(r => leagueTier(r.league_name) <= 2),
    [rows, showTier3]
  );

  const counts = useMemo(() => ({
    ALL:     tierFiltered.length,
    WON:     tierFiltered.filter(r => r.status === "finished" && r.was_correct === true).length,
    LOST:    tierFiltered.filter(r => r.status === "finished" && r.was_correct === false).length,
    PENDING: tierFiltered.filter(r => r.status === "pending").length,
    VALUE:   tierFiltered.filter(r => r.value_bet_hit).length,
  }), [tierFiltered]);

  const filtered = tierFiltered.filter(r => {
    if (filter === "WON")     return r.status === "finished" && r.was_correct === true;
    if (filter === "LOST")    return r.status === "finished" && r.was_correct === false;
    if (filter === "PENDING") return r.status === "pending";
    if (filter === "VALUE")   return r.value_bet_hit;
    return true;
  });

  const hasBets = stats.betCount > 0;
  const tier3Count = rows.filter(r => leagueTier(r.league_name) === 3).length;

  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }} dir="rtl">
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 24px" }}>

        {/* ── Hero ── */}
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="m-0 text-2xl font-black text-white">ביצועים היסטוריים 📊</h1>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
              שקיפות מלאה
            </span>
          </div>
          <p className="m-0 text-sm text-slate-500">
            כל ניבוי מתועד אוטומטית — כולל המחדלים.
          </p>
        </div>

        {/* ── 4 stat cards ── */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">

          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <div className="mb-1 text-xs text-slate-400">רווח נקי (יחידות)</div>
            <div className={`flex items-center gap-1 font-mono text-2xl font-bold ${
              !hasBets ? "text-slate-600" : stats.units >= 0 ? "text-emerald-400" : "text-slate-400"}`}>
              {hasBets ? (
                <>{stats.units >= 0 ? "+" : ""}{stats.units}
                  {stats.units >= 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                </>
              ) : "—"}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {hasBets ? `Flat · ${stats.betCount} הימורים עם יחס שוק` : "ממתין לתוצאות"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <div className="mb-1 text-xs text-slate-400">תשואה (Yield)</div>
            <div className={`font-mono text-2xl font-bold ${
              !hasBets ? "text-slate-600" : stats.yieldPct >= 0 ? "text-sky-400" : "text-slate-400"}`}>
              {hasBets ? `${stats.yieldPct >= 0 ? "+" : ""}${stats.yieldPct}%` : "—"}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">רווח יחסית למחזור</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <div className="mb-1 text-xs text-slate-400">דיוק כללי</div>
            <div className="font-mono text-2xl font-bold text-slate-200">
              {summary && summary.total > 0 ? `${summary.accuracy}%` : "—"}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {summary && summary.total > 0
                ? `${summary.correct} / ${summary.total} פגעו`
                : "מצטבר עם סיום משחקים"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <div className="mb-1 text-xs text-slate-400">יחס ממוצע</div>
            <div className="font-mono text-2xl font-bold text-amber-400">
              {hasBets ? stats.avgOdds.toFixed(2) : "—"}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">יחסי שוק ממוצע על הניבוי</div>
          </div>
        </div>

        {/* ── Profit chart ── */}
        <div className="mb-8 rounded-xl border border-slate-800 bg-[#0F1318] p-5">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 rounded-full bg-emerald-500" />
              <h3 className="m-0 text-sm font-bold text-slate-200">גרף רווח מצטבר (יחידות)</h3>
            </div>
            <span className="font-mono text-xs text-slate-500">Units / Time</span>
          </div>

          {stats.chart.length >= 2 ? (
            <div style={{ width: "100%", height: 240, direction: "ltr" }} className="font-mono text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.chart} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" tickLine={false} fontSize={10} />
                  <YAxis stroke="#64748b" tickLine={false} fontSize={10} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: 8, color: "#fff", fontSize: 11 }}
                    formatter={(v) => [`${v} יח׳`, "רווח מצטבר"]}
                  />
                  <Area type="monotone" dataKey="units" stroke="#10b981" strokeWidth={2} fill="url(#cu)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-10 text-center">
              <div className="mb-2 text-3xl">📈</div>
              <div className="text-sm text-slate-500">הגרף ייבנה עם הצטברות תוצאות עם יחסי שוק</div>
              {summary?.pending ? (
                <div className="mt-1 text-xs text-slate-600">{summary.pending} ניבויים ממתינים לתוצאה</div>
              ) : null}
            </div>
          )}
        </div>

        {/* ── Archive table ── */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0F1318]">

          {/* Filter bar */}
          <div className="flex flex-col items-start justify-between gap-3 border-b border-slate-800 p-4 text-xs sm:flex-row sm:items-center">

            {/* Result filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <Filter size={13} className="text-slate-500" />
              <div className="flex rounded-lg border border-slate-800 bg-[#0B0E14] p-1">
                {([
                  { key: "ALL",     label: "הכל"       },
                  { key: "WON",     label: "✓ פגיעה"   },
                  { key: "LOST",    label: "✗ פספוס"   },
                  { key: "VALUE",   label: "⚡ Value"   },
                  { key: "PENDING", label: "⏱ ממתינים" },
                ] as { key: ResultFilter; label: string }[]).map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className="rounded-md px-3 py-1 font-bold transition-colors"
                    style={{
                      background: filter === f.key
                        ? (f.key === "WON"  ? "rgba(16,185,129,.15)"
                          : f.key === "LOST" ? "rgba(100,116,139,.2)"
                          : f.key === "VALUE" ? "rgba(34,211,238,.12)"
                          : "rgba(255,255,255,.08)")
                        : "transparent",
                      color: filter === f.key
                        ? (f.key === "WON"  ? "#10b981"
                          : f.key === "LOST" ? "#94a3b8"
                          : f.key === "VALUE" ? "#22d3ee"
                          : "#fff")
                        : "#475569",
                    }}
                  >
                    {f.label} ({counts[f.key]})
                  </button>
                ))}
              </div>
            </div>

            {/* Tier 3 toggle */}
            <div className="flex items-center gap-3">
              {tier3Count > 0 && (
                <button
                  onClick={() => setShowTier3(v => !v)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0B0E14] px-3 py-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-300"
                >
                  <EyeOff size={12} />
                  {showTier3 ? "הסתר" : "הצג"} ליגות Tier 3 ({tier3Count})
                </button>
              )}
              <div className="flex items-center gap-1 font-mono text-slate-500">
                <Calendar size={13} />
                <span>{filtered.length} רשומות</span>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="p-3.5 font-semibold">תאריך</th>
                  <th className="p-3.5 font-semibold">ליגה</th>
                  <th className="p-3.5 font-semibold">משחק</th>
                  <th className="p-3.5 font-semibold">ניבוי</th>
                  <th className="p-3.5 font-mono font-semibold">יחס</th>
                  <th className="p-3.5 font-semibold">ביטחון</th>
                  <th className="p-3.5 text-center font-semibold">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {loading ? (
                  <tr><td colSpan={7} className="p-10 text-center text-slate-500">טוען ארכיון...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="p-10 text-center text-slate-500">אין רשומות בסינון הנבחר</td></tr>
                ) : filtered.map((r, i) => {
                  const pick    = pickOf(r);
                  const odds    = oddsOf(r);
                  const pending = r.status === "pending";
                  const wc      = isWorldCup(r.league_name);

                  return (
                    <tr
                      key={`${r.fixture_id}-${i}`}
                      className="transition-colors hover:bg-white/[0.02]"
                      style={wc ? { borderRight: "2px solid rgba(245,158,11,.3)" } : undefined}
                    >
                      {/* Date */}
                      <td className="p-3.5 font-mono text-slate-400">{fmtDate(r.match_date)}</td>

                      {/* League + tier badge */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5">
                          <LeagueBadge name={r.league_name} />
                          <span className="max-w-[110px] truncate text-slate-400">
                            {r.league_name ?? "—"}
                          </span>
                        </div>
                      </td>

                      {/* Match */}
                      <td className="p-3.5 font-medium text-slate-200" style={{ direction: "ltr", textAlign: "right" }}>
                        {r.home_team_name} <span className="text-slate-600">vs</span> {r.away_team_name}
                      </td>

                      {/* Prediction */}
                      <td className="p-3.5 font-medium text-sky-400">
                        {pick
                          ? <>{OUTCOME_12X[pick]} <span className="text-[10px] text-slate-500">({OUTCOME_HE[pick]})</span></>
                          : "—"}
                        {r.value_bet_hit && <Zap size={11} className="mr-1 inline text-cyan-400" />}
                      </td>

                      {/* Odds */}
                      <td className="p-3.5 font-mono font-bold text-slate-300" style={{ direction: "ltr" }}>
                        {odds ? odds.toFixed(2) : "—"}
                      </td>

                      {/* Confidence */}
                      <td className="p-3.5 font-mono text-slate-400">
                        {r.confidence_score ? `${Math.round(r.confidence_score)}%` : "—"}
                      </td>

                      {/* Status — color system: emerald=hit, slate=miss, NO red */}
                      <td className="p-3.5 text-center">
                        {pending ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2.5 py-1 text-[11px] font-bold text-indigo-300">
                            <Clock3 size={11} /> ממתין
                          </span>
                        ) : r.was_correct ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                            <CheckCircle2 size={11} /> פגיעה
                          </span>
                        ) : (
                          // Slate — not red. Red is reserved for live indicators only.
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/30 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                            <MinusCircle size={11} /> פספוס
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-800 p-4 text-center text-[11px] text-slate-600">
            רווח מחושב על ניבויים עם יחסי שוק (Flat staking יחידה אחת) · Tier 3 מוסתר כברירת מחדל · הנתונים מתעדכנים אוטומטית
          </div>
        </div>

      </main>
    </div>
  );
}
