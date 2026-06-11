"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users, ShieldCheck, Flame, Award, ArrowLeftRight, PenSquare, Plus,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/* ── Types ───────────────────────────────────────────────────────────────── */
interface Analyst {
  id: string;
  name: string;
  expertise_league: string;
  accuracy_pct: number;
  win_rate: number;
  total_predictions: number;
  correct_predictions: number;
}

interface LiveMatch {
  fixture_id: number;
  home_team: string;
  away_team: string;
  league: string;
  match_date: string;
  prediction: { final: { home: number; draw: number; away: number }; confidence: number };
}

interface AnalystPrediction {
  name: string;
  analyst_id: string;
  predicted_outcome: string;
  confidence_level: number;
  reasoning: string;
  win_rate: number;
}

interface ConsensusLock {
  fixture_id: number | null;
  home_team: string;
  away_team: string;
  league: string | null;
  match_date: string | null;
  algo_pick: "home" | "draw" | "away";
  algo_prob: number;
  agreeing_count: number;
  total_analysts: number;
  market_odds: number | null;
}

type FormResult = "W" | "L";

const NAV = [
  { label: "סיגנלים חמים",      href: "/" },
  { label: "כל המשחקים",        href: "/matches" },
  { label: "ביצועים היסטוריים", href: "/track-record" },
  { label: "אנליסטים",          href: "/analysts", active: true },
];

const OUTCOME_HE:  Record<string, string> = { home: "ניצחון בית", draw: "תיקו", away: "ניצחון חוץ" };
const OUTCOME_12X: Record<string, string> = { home: "1", draw: "X", away: "2" };
const OUTCOME_COLOR: Record<string, string> = { home: "#10b981", draw: "#f59e0b", away: "#ef4444" };

function initialsOf(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function AnalystsPage() {
  const [analysts, setAnalysts]   = useState<Analyst[]>([]);
  const [forms, setForms]         = useState<Record<string, FormResult[]>>({});
  const [locks, setLocks]         = useState<ConsensusLock[]>([]);
  const [matches, setMatches]     = useState<LiveMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<LiveMatch | null>(null);
  const [matchPredictions, setMatchPredictions] = useState<AnalystPrediction[]>([]);

  // prediction form state
  const [selectedAnalyst, setSelectedAnalyst] = useState("");
  const [outcome, setOutcome]       = useState<"home" | "draw" | "away" | "">("");
  const [confidence, setConfidence] = useState(7);
  const [reasoning, setReasoning]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg]   = useState("");

  // add-analyst form state
  const [newName, setNewName]           = useState("");
  const [newLeague, setNewLeague]       = useState("");
  const [addingAnalyst, setAddingAnalyst] = useState(false);
  const [showAddForm, setShowAddForm]   = useState(false);

  /* ── Data fetching ── */
  const fetchAnalysts = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/analysts`);
      const d = await r.json();
      const list: Analyst[] = d.analysts ?? [];
      setAnalysts(list);

      // real last-5 form per analyst (resolved predictions only)
      const formEntries = await Promise.all(list.map(async (a) => {
        try {
          const hr = await fetch(`${API}/api/analysts/${a.id}/history?limit=20`);
          const hd = await hr.json();
          const resolved = (hd.history ?? [])
            .filter((h: { was_correct: boolean | null }) => h.was_correct !== null)
            .slice(0, 5)
            .map((h: { was_correct: boolean }) => (h.was_correct ? "W" : "L") as FormResult);
          return [a.id, resolved] as const;
        } catch { return [a.id, []] as const; }
      }));
      setForms(Object.fromEntries(formEntries));
    } catch { /* silent */ }
  }, []);

  const fetchLocks = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/analysts/consensus-locks`);
      const d = await r.json();
      setLocks(d.locks ?? []);
    } catch { /* silent */ }
  }, []);

  const fetchMatches = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/live/matches?limit=8`);
      const d = await r.json();
      // dedupe — הפיד מחזיר לעיתים את אותו משחק פעמיים
      const seen = new Set<number>();
      setMatches((d.matches ?? []).filter((m: LiveMatch) => {
        if (seen.has(m.fixture_id)) return false;
        seen.add(m.fixture_id);
        return true;
      }));
    } catch { /* silent */ }
  }, []);

  const fetchMatchPredictions = useCallback(async (fixtureId: number) => {
    try {
      const r = await fetch(`${API}/api/analysts/match/${fixtureId}`);
      const d = await r.json();
      setMatchPredictions(d.predictions ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchAnalysts(); fetchMatches(); fetchLocks(); }, [fetchAnalysts, fetchMatches, fetchLocks]);
  useEffect(() => { if (selectedMatch) fetchMatchPredictions(selectedMatch.fixture_id); }, [selectedMatch, fetchMatchPredictions]);

  /* ── Actions ── */
  async function handleSubmitPrediction() {
    if (!selectedMatch || !selectedAnalyst || !outcome) return;
    setSubmitting(true);
    setSubmitMsg("");
    try {
      const r = await fetch(`${API}/api/analysts/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixture_id: selectedMatch.fixture_id,
          analyst_id: selectedAnalyst,
          outcome, confidence, reasoning,
        }),
      });
      const d = await r.json();
      if (r.ok) {
        setSubmitMsg("✅ " + d.message);
        setOutcome("");
        setReasoning("");
        fetchMatchPredictions(selectedMatch.fixture_id);
        fetchLocks();           // ניבוי חדש יכול ליצור נעילה
        fetchAnalysts();
      } else {
        setSubmitMsg("❌ " + (d.detail ?? "שגיאה"));
      }
    } catch { setSubmitMsg("❌ שגיאת רשת"); }
    finally { setSubmitting(false); }
  }

  async function handleAddAnalyst() {
    if (!newName.trim()) return;
    setAddingAnalyst(true);
    try {
      const r = await fetch(`${API}/api/analysts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), expertise_league: newLeague.trim() }),
      });
      if (r.ok) {
        setNewName(""); setNewLeague(""); setShowAddForm(false);
        fetchAnalysts();
      }
    } finally { setAddingAnalyst(false); }
  }

  const algo = selectedMatch?.prediction?.final;

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

        {/* ── Header ── */}
        <div className="mb-10 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-sky-500/10 p-3 text-sky-400">
              <Users size={26} />
            </div>
            <div>
              <h1 className="m-0 mb-1 text-2xl font-black text-white">צוות האנליסטים של Analyst365</h1>
              <p className="m-0 text-sm text-slate-500">
                הצלבת חישובי האלגוריתם עם ניתוח אנושי — קונסנזוס בין מכונה לאדם.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[13px] font-bold text-emerald-400 transition hover:bg-emerald-500/20"
          >
            <Plus size={14} /> הוסף אנליסט
          </button>
        </div>

        {/* ── Add analyst form ── */}
        {showAddForm && (
          <div className="mb-8 rounded-xl border border-emerald-500/20 bg-[#0F1318] p-5">
            <h3 className="m-0 mb-4 text-sm font-bold text-white">אנליסט חדש</h3>
            <div className="flex flex-wrap gap-3">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="שם האנליסט *"
                className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-[13px] text-white outline-none"
              />
              <input
                value={newLeague}
                onChange={e => setNewLeague(e.target.value)}
                placeholder="התמחות (ליגה / אזור)"
                className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-[13px] text-white outline-none"
              />
              <button
                onClick={handleAddAnalyst}
                disabled={addingAnalyst || !newName.trim()}
                className="rounded-lg bg-emerald-500 px-5 py-2.5 text-[13px] font-bold text-[#0B0E14] disabled:opacity-40"
              >
                {addingAnalyst ? "..." : "שמור"}
              </button>
            </div>
          </div>
        )}

        {/* ── Team cards ── */}
        <div className="mb-12">
          <div className="mb-5 flex items-center gap-2">
            <div className="h-4 w-1 rounded-full bg-sky-500" />
            <h2 className="m-0 text-base font-bold text-slate-200">הצוות ({analysts.length})</h2>
            <span className="text-[11px] text-slate-600">· לחץ על כרטיס כדי לבחור אנליסט להזנת ניבוי</span>
          </div>

          {analysts.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-10 text-center text-sm text-slate-500">
              עדיין אין אנליסטים — לחץ "הוסף אנליסט" כדי להתחיל
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {analysts.map(a => {
                const form = forms[a.id] ?? [];
                const isSelected = selectedAnalyst === a.id;
                const hasRecord = a.total_predictions > 0;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAnalyst(isSelected ? "" : a.id)}
                    className={`flex flex-col justify-between rounded-xl border p-5 text-right transition ${
                      isSelected
                        ? "border-emerald-500/50 bg-emerald-500/[0.06]"
                        : "border-slate-800 bg-[#0F1318] hover:border-slate-700"}`}
                  >
                    <div>
                      <div className="mb-4 flex items-center gap-3.5">
                        {/* initials avatar — no fake photos */}
                        <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-slate-700 bg-slate-800 text-base font-black text-slate-200">
                          {initialsOf(a.name)}
                        </div>
                        <div>
                          <h3 className="m-0 flex items-center gap-1 text-sm font-bold text-slate-100">
                            {a.name}
                            <ShieldCheck size={14} className="text-sky-400" />
                          </h3>
                          <p className="m-0 mt-0.5 text-[11px] text-slate-500">
                            {a.expertise_league || "אנליסט כללי"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2 border-t border-slate-800 pt-2.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">אחוז דיוק:</span>
                          <span className={`font-mono font-bold ${hasRecord ? "text-emerald-400" : "text-slate-600"}`}>
                            {hasRecord ? `${a.accuracy_pct}%` : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">סה״כ ניבויים:</span>
                          <span className="font-mono font-bold text-slate-300">{a.total_predictions}</span>
                        </div>
                      </div>
                    </div>

                    {/* real last-5 form */}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs">
                      <span className="text-slate-500">5 אחרונים:</span>
                      {form.length === 0 ? (
                        <span className="text-[10px] text-slate-600">טרם נצברו תוצאות</span>
                      ) : (
                        <div className="flex gap-1" dir="ltr">
                          {form.map((res, i) => (
                            <span key={i} className={`flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-bold ${
                              res === "W" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                              {res}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Consensus locks ── */}
        <div className="mb-12 rounded-xl border border-slate-800 bg-[#0F1318] p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame size={18} className="animate-pulse text-amber-500" />
              <h2 className="m-0 text-base font-bold text-slate-200">נעילות קונסנזוס פעילות</h2>
            </div>
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-mono text-xs font-bold text-amber-400">
              {locks.length} בהסכמה מלאה
            </span>
          </div>

          {locks.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              אין כרגע נעילות קונסנזוס פעילות. ברגע שהאלגוריתם והאנליסטים יסכימו על משחק — הוא יופיע כאן מיד.
            </div>
          ) : (
            <div className="space-y-4">
              {locks.map(lock => (
                <div key={`${lock.fixture_id}`} className="flex flex-col items-center justify-between gap-5 rounded-xl border border-slate-800 bg-[#0B0E14] p-5 md:flex-row">

                  {/* match info */}
                  <div className="flex w-full flex-col gap-1 md:w-auto">
                    {lock.league && (
                      <span className="self-start rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400">
                        {lock.league}
                      </span>
                    )}
                    <div className="mt-1 text-sm font-bold text-slate-200">
                      {lock.home_team} <span className="px-1 font-medium text-slate-600">vs</span> {lock.away_team}
                    </div>
                    {lock.match_date && <span className="mt-0.5 text-xs text-slate-500">{fmtDate(lock.match_date)}</span>}
                  </div>

                  {/* the consensus */}
                  <div className="flex w-full items-center justify-around gap-4 rounded-lg border border-slate-800/80 bg-[#0F1318] p-3 text-xs md:w-80">
                    <div className="text-center">
                      <span className="mb-0.5 block text-[10px] text-slate-500">🤖 אלגוריתם</span>
                      <span className="font-bold text-sky-400">
                        {OUTCOME_12X[lock.algo_pick]} ({OUTCOME_HE[lock.algo_pick]}) · {Math.round(lock.algo_prob * 100)}%
                      </span>
                    </div>
                    <ArrowLeftRight size={14} className="shrink-0 text-slate-600" />
                    <div className="text-center">
                      <span className="mb-0.5 block text-[10px] text-slate-500">👥 אנליסטים</span>
                      <span className="font-bold text-emerald-400">
                        {lock.agreeing_count}/{lock.total_analysts} סימנו {OUTCOME_12X[lock.algo_pick]}
                      </span>
                    </div>
                  </div>

                  {/* market odds + badge */}
                  <div className="flex w-full items-center justify-between gap-4 border-t border-slate-800/60 pt-3 md:w-auto md:justify-end md:border-t-0 md:pt-0">
                    <div className="text-right">
                      <span className="block text-[10px] text-slate-500">יחס בשוק</span>
                      <span className="font-mono text-base font-bold text-amber-400" dir="ltr">
                        {lock.market_odds ? lock.market_odds.toFixed(2) : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-l from-amber-500 to-orange-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-md">
                      <Award size={14} />
                      <span>נעילת זהב ⭐</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Prediction entry panel ── */}
        <div className="mb-5 flex items-center gap-2">
          <div className="h-4 w-1 rounded-full bg-emerald-500" />
          <h2 className="m-0 flex items-center gap-1.5 text-base font-bold text-slate-200">
            <PenSquare size={15} className="text-emerald-400" /> הזנת ניבוי חדש
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

          {/* match selector */}
          <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
            <h3 className="m-0 mb-3.5 text-sm font-bold text-white">🎯 בחר משחק</h3>
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {matches.length === 0 ? (
                <div className="py-2 text-[13px] text-slate-500">טוען משחקים...</div>
              ) : matches.map(m => (
                <button
                  key={m.fixture_id}
                  onClick={() => setSelectedMatch(m)}
                  className={`rounded-lg border px-3.5 py-2.5 text-right transition ${
                    selectedMatch?.fixture_id === m.fixture_id
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-white/5 bg-white/[0.03] hover:border-white/15"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">{m.league}</span>
                    <span className="text-[11px] text-slate-600">{m.match_date?.slice(0, 10)}</span>
                  </div>
                  <div className="mt-1 text-[13px] font-bold text-white">
                    {m.home_team} <span className="font-normal text-slate-600">נגד</span> {m.away_team}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* prediction form + per-match consensus */}
          <div className="flex flex-col gap-5">
            {selectedMatch ? (
              <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
                <h3 className="m-0 mb-1 text-sm font-bold text-white">✏️ הזן ניבוי</h3>
                <p className="m-0 mb-4 text-xs text-slate-500">
                  {selectedMatch.home_team} נגד {selectedMatch.away_team}
                  {selectedAnalyst
                    ? <> · בשם <span className="font-bold text-emerald-400">{analysts.find(a => a.id === selectedAnalyst)?.name}</span></>
                    : <> · <span className="text-amber-400">בחר אנליסט מהכרטיסים למעלה</span></>}
                </p>

                {algo && (
                  <div className="mb-4 flex items-center gap-3 rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-xs">
                    <span className="text-slate-500">אלגוריתם:</span>
                    {(["home", "draw", "away"] as const).map(o => (
                      <span key={o} style={{ color: OUTCOME_COLOR[o] }}>
                        {OUTCOME_12X[o]} {Math.round(algo[o] * 100)}%
                      </span>
                    ))}
                  </div>
                )}

                <div className="mb-4 flex gap-2">
                  {(["home", "draw", "away"] as const).map(o => (
                    <button
                      key={o}
                      onClick={() => setOutcome(o)}
                      className="flex-1 rounded-lg py-2.5 text-[13px] font-bold transition"
                      style={{
                        border: outcome === o ? `1px solid ${OUTCOME_COLOR[o]}` : "1px solid rgba(255,255,255,0.1)",
                        background: outcome === o ? `${OUTCOME_COLOR[o]}18` : "transparent",
                        color: outcome === o ? OUTCOME_COLOR[o] : "#64748b",
                      }}
                    >
                      {OUTCOME_12X[o]} · {OUTCOME_HE[o]}
                    </button>
                  ))}
                </div>

                <div className="mb-4">
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="text-slate-400">רמת ביטחון</span>
                    <span className="font-bold text-white">{confidence}/10</span>
                  </div>
                  <input
                    type="range" min={1} max={10} value={confidence}
                    onChange={e => setConfidence(+e.target.value)}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <textarea
                  value={reasoning}
                  onChange={e => setReasoning(e.target.value)}
                  placeholder="נימוק קצר (אופציונלי)..."
                  rows={2}
                  className="mb-3.5 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-[13px] text-white outline-none"
                />

                <button
                  onClick={handleSubmitPrediction}
                  disabled={!outcome || !selectedAnalyst || submitting}
                  className="w-full rounded-lg bg-emerald-500 py-3 text-sm font-extrabold text-[#0B0E14] transition disabled:opacity-30"
                >
                  {submitting ? "שומר..." : "שלח ניבוי"}
                </button>

                {submitMsg && (
                  <div className={`mt-2.5 text-center text-[13px] ${submitMsg.startsWith("✅") ? "text-emerald-400" : "text-rose-400"}`}>
                    {submitMsg}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-8 text-center text-sm text-slate-500">
                בחר משחק מהרשימה כדי להזין ניבוי
              </div>
            )}

            {/* per-match analyst predictions */}
            {selectedMatch && matchPredictions.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-[#0F1318] p-5">
                <h3 className="m-0 mb-3.5 text-sm font-bold text-white">🤝 ניבויים שהוזנו למשחק</h3>
                <div className="flex flex-col gap-2">
                  {matchPredictions.map((p, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                      <div>
                        <span className="text-[13px] font-semibold text-white">{p.name}</span>
                        {p.reasoning && <span className="mr-2 text-[11px] text-slate-500">· {p.reasoning}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">{p.confidence_level}/10</span>
                        <span
                          className="rounded-md px-2 py-0.5 text-[13px] font-bold"
                          style={{
                            color: OUTCOME_COLOR[p.predicted_outcome] ?? "white",
                            background: `${OUTCOME_COLOR[p.predicted_outcome] ?? "#fff"}18`,
                            border: `1px solid ${OUTCOME_COLOR[p.predicted_outcome] ?? "#fff"}40`,
                          }}
                        >
                          {OUTCOME_12X[p.predicted_outcome] ?? p.predicted_outcome}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
