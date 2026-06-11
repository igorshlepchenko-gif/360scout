"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  ArrowUpRight, ArrowDownRight, CheckCircle2, XCircle, Clock3, Filter, Calendar, Zap,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const OUTCOME_HE:  Record<string, string> = { home: "ניצחון בית", draw: "תיקו", away: "ניצחון חוץ" };
const OUTCOME_12X: Record<string, string> = { home: "1", draw: "X", away: "2" };

const NAV = [
  { label: "סיגנלים חמים",      href: "/" },
  { label: "כל המשחקים",        href: "/matches" },
  { label: "ביצועים היסטוריים", href: "/track-record", active: true },
  { label: "אנליסטים",          href: "/analysts" },
];

/* ── Types (track-record API shape) ─────────────────────────────────────── */
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

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** The outcome the algorithm picked — stored field, else highest probability. */
function pickOf(r: TrackRow): "home" | "draw" | "away" | null {
  if (r.predicted_outcome === "home" || r.predicted_outcome === "draw" || r.predicted_outcome === "away") {
    return r.predicted_outcome;
  }
  if (r.final_prob_home == null) return null;
  const probs = { home: r.final_prob_home ?? 0, draw: r.final_prob_draw ?? 0, away: r.final_prob_away ?? 0 };
  return (Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0]) as "home" | "draw" | "away";
}

/** Market odds for the picked outcome (null when no market data was stored). */
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

type ResultFilter = "ALL" | "WON" | "LOST" | "PENDING";

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function TrackRecordPage() {
  const [rows, setRows]       = useState<TrackRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<ResultFilter>("ALL");

  useEffect(() => {
    fetch(`${API}/api/live/track-record?limit=100`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setRows(d.recent ?? []);
        setSummary(d.summary ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* ── Real betting stats — flat staking on matches that HAD market odds ── */
  const stats = useMemo(() => {
    const resolved = rows.filter(r => r.status === "finished" && r.was_correct !== null);
    const bets = resolved
      .map(r => ({ r, odds: oddsOf(r) }))
      .filter((b): b is { r: TrackRow; odds: number } => b.odds !== null);

    let units = 0;
    const cum: { date: string; units: number; ts: number }[] = [];
    const sorted = [...bets].sort((a, b) =>
      new Date(a.r.match_date ?? 0).getTime() - new Date(b.r.match_date ?? 0).getTime());

    for (const b of sorted) {
      units += b.r.was_correct ? b.odds - 1 : -1;
      cum.push({
        date: fmtDate(b.r.match_date),
        units: Math.round(units * 100) / 100,
        ts: new Date(b.r.match_date ?? 0).getTime(),
      });
    }

    const avgOdds = bets.length ? bets.reduce((s, b) => s + b.odds, 0) / bets.length : 0;
    const yieldPct = bets.length ? (units / bets.length) * 100 : 0;

    return {
      betCount: bets.length,
      resolvedCount: resolved.length,
      units: Math.round(units * 100) / 100,
      yieldPct: Math.round(yieldPct * 10) / 10,
      avgOdds: Math.round(avgOdds * 100) / 100,
      chart: cum,
    };
  }, [rows]);

  /* ── Table filtering ── */
  const counts = useMemo(() => ({
    ALL:     rows.length,
    WON:     rows.filter(r => r.status === "finished" && r.was_correct === true).length,
    LOST:    rows.filter(r => r.status === "finished" && r.was_correct === false).length,
    PENDING: rows.filter(r => r.status === "pending").length,
  }), [rows]);

  const filtered = rows.filter(r => {
    if (filter === "WON")     return r.status === "finished" && r.was_correct === true;
    if (filter === "LOST")    return r.status === "finished" && r.was_correct === false;
    if (filter === "PENDING") return r.status === "pending";
    return true;
  });

  const hasBets = stats.betCount > 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }} dir="rtl">

      {/* Navbar */}
      <nav style={{
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0,
        background: "rgba(11,14,20,0.95)", backdropFilter: "blur(12px)", zIndex: 50,
      }}>
        <a href="/" style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-0.5px", textDecoration: "none", direction: "ltr" }}>
          <span style={{ color: "#10b981" }}>ANALYST</span>
          <span style={{ color: "white" }}>365</span>
        </a>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {NAV.map(item => (
            <a key={item.label} href={item.href} style={{
              color: item.active ? "white" : "#64748b",
              fontSize: 14, fontWeight: item.active ? 600 : 400, textDecoration: "none",
            }}>{item.label}</a>
          ))}
        </div>
      </nav>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 24px" }}>

        {/* Hero */}
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="m-0 text-2xl font-black text-white">ביצועים היסטוריים וארכיון 📊</h1>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
              שקיפות מלאה
            </span>
          </div>
          <p className="m-0 text-sm text-slate-500">
            מעקב אמיתי אחר ביצועי האלגוריתם — כל ניבוי מתועד אוטומטית, כולל המחדלים.
          </p>
        </div>

        {/* ── Stats cards ── */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {/* Units */}
          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <div className="mb-1 text-xs text-slate-400">רווח נקי (יחידות)</div>
            <div className={`flex items-center gap-1 font-mono text-2xl font-bold ${
              !hasBets ? "text-slate-600" : stats.units >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {hasBets ? (
                <>
                  {stats.units >= 0 ? "+" : ""}{stats.units}
                  {stats.units >= 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                </>
              ) : "—"}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {hasBets ? `Flat staking · ${stats.betCount} הימורים עם יחס שוק` : "ממתין לתוצאות עם יחסי שוק"}
            </div>
          </div>

          {/* Yield */}
          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <div className="mb-1 text-xs text-slate-400">תשואה (Yield)</div>
            <div className={`font-mono text-2xl font-bold ${
              !hasBets ? "text-slate-600" : stats.yieldPct >= 0 ? "text-sky-400" : "text-rose-400"}`}>
              {hasBets ? `${stats.yieldPct >= 0 ? "+" : ""}${stats.yieldPct}%` : "—"}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">רווח ביחס לסך המחזור</div>
          </div>

          {/* Accuracy */}
          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <div className="mb-1 text-xs text-slate-400">אחוז דיוק כללי</div>
            <div className="font-mono text-2xl font-bold text-slate-200">
              {summary && summary.total > 0 ? `${summary.accuracy}%` : "—"}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {summary && summary.total > 0
                ? `${summary.correct} מתוך ${summary.total} ניבויים פגעו`
                : "מצטבר עם סיום משחקים"}
            </div>
          </div>

          {/* Avg odds */}
          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <div className="mb-1 text-xs text-slate-400">יחס ממוצע שנלקח</div>
            <div className="font-mono text-2xl font-bold text-amber-400">
              {hasBets ? stats.avgOdds.toFixed(2) : "—"}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">ממוצע יחסי השוק על הניבוי</div>
          </div>
        </div>

        {/* ── Cumulative profit chart ── */}
        <div className="mb-8 rounded-xl border border-slate-800 bg-[#0F1318] p-5">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 rounded-full bg-emerald-500" />
              <h3 className="m-0 text-sm font-bold text-slate-200">גרף רווח מצטבר (יחידות)</h3>
            </div>
            <span className="font-mono text-xs text-slate-500">Units / Time</span>
          </div>

          {stats.chart.length >= 2 ? (
            <div style={{ width: "100%", height: 256, direction: "ltr" }} className="font-mono text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.chart} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorUnits" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" tickLine={false} fontSize={10} />
                  <YAxis stroke="#64748b" tickLine={false} fontSize={10} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: 8, color: "#fff", textAlign: "right", fontSize: 11 }}
                    labelFormatter={(label) => `תאריך: ${label}`}
                    formatter={(value) => [`${value} יח׳`, "רווח מצטבר"]}
                  />
                  <Area type="monotone" dataKey="units" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorUnits)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-12 text-center">
              <div className="mb-2 text-3xl">📈</div>
              <div className="text-sm text-slate-500">הגרף ייבנה אוטומטית עם הצטברות תוצאות למשחקים עם יחסי שוק</div>
              <div className="mt-1 text-xs text-slate-600">
                {summary?.pending ? `${summary.pending} ניבויים ממתינים כרגע לתוצאה` : "המערכת שומרת ניבויים כל 5 דקות"}
              </div>
            </div>
          )}
        </div>

        {/* ── Archive table ── */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0F1318]">

          {/* Filter bar */}
          <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-800 p-4 text-xs sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-slate-500" />
              <span className="font-semibold text-slate-400">סינון תוצאות:</span>
              <div className="flex rounded-lg border border-slate-800 bg-[#0B0E14] p-1">
                {([
                  { key: "ALL",     label: "הכל",     on: "bg-slate-800 text-white" },
                  { key: "WON",     label: "תפס",     on: "bg-emerald-500/20 text-emerald-400" },
                  { key: "LOST",    label: "נפל",     on: "bg-rose-500/20 text-rose-400" },
                  { key: "PENDING", label: "ממתינים", on: "bg-indigo-500/20 text-indigo-300" },
                ] as { key: ResultFilter; label: string; on: string }[]).map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-md px-3 py-1 font-bold transition-colors ${
                      filter === f.key ? f.on : "text-slate-400 hover:text-slate-200"}`}
                  >
                    {f.label} ({counts[f.key]})
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 font-mono text-slate-500">
              <Calendar size={14} />
              <span>מציג {filtered.length} רשומות</span>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="p-3.5 font-semibold">תאריך</th>
                  <th className="p-3.5 font-semibold">ליגה</th>
                  <th className="p-3.5 font-semibold">משחק</th>
                  <th className="p-3.5 font-semibold">הניבוי</th>
                  <th className="p-3.5 font-mono font-semibold">יחס</th>
                  <th className="p-3.5 font-semibold">ביטחון</th>
                  <th className="p-3.5 text-center font-semibold">תוצאה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {loading ? (
                  <tr><td colSpan={7} className="p-10 text-center text-slate-500">טוען ארכיון...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="p-10 text-center text-slate-500">
                    אין רשומות בסינון הנבחר
                  </td></tr>
                ) : filtered.map((r, i) => {
                  const pick    = pickOf(r);
                  const odds    = oddsOf(r);
                  const pending = r.status === "pending";
                  return (
                    <tr key={`${r.fixture_id}-${i}`} className="transition-colors hover:bg-white/[0.02]">
                      <td className="p-3.5 font-mono text-slate-400">{fmtDate(r.match_date)}</td>
                      <td className="max-w-[140px] truncate p-3.5 font-medium text-slate-400">{r.league_name ?? "—"}</td>
                      <td className="p-3.5 font-medium text-slate-200">
                        {r.home_team_name} <span className="text-slate-600">נגד</span> {r.away_team_name}
                      </td>
                      <td className="p-3.5 font-medium text-sky-400">
                        {pick ? <>{OUTCOME_12X[pick]} <span className="text-[10px] text-slate-500">({OUTCOME_HE[pick]})</span></> : "—"}
                        {r.value_bet_hit && <Zap size={11} className="mr-1 inline text-amber-400" />}
                      </td>
                      <td className="p-3.5 font-mono font-bold text-slate-300" style={{ direction: "ltr" }}>
                        {odds ? odds.toFixed(2) : "—"}
                      </td>
                      <td className="p-3.5 font-mono text-slate-400">
                        {r.confidence_score ? `${Math.round(r.confidence_score)}%` : "—"}
                      </td>
                      <td className="p-3.5 text-center">
                        {pending ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2.5 py-1 font-bold text-indigo-300">
                            <Clock3 size={12} /> ממתין
                          </span>
                        ) : r.was_correct ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 font-bold text-emerald-400">
                            <CheckCircle2 size={12} /> תפס
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2.5 py-1 font-bold text-rose-400">
                            <XCircle size={12} /> נפל
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
            רווח ביחידות מחושב רק על ניבויים שהיו להם יחסי שוק בזמן הניבוי (Flat staking של יחידה אחת) · הנתונים מתעדכנים אוטומטית
          </div>
        </div>
      </main>
    </div>
  );
}
