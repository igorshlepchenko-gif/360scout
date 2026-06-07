"use client";

import { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

const NAV = [
  { label: "סיגנלים חמים",      href: "/" },
  { label: "כל המשחקים",        href: "/" },
  { label: "ביצועים היסטוריים", href: "/track-record" },
  { label: "אנליסטים",          href: "/analysts", active: true },
];

const OUTCOME_HE: Record<string, string> = { home: "בית", draw: "תיקו", away: "אורחים" };
const OUTCOME_COLOR: Record<string, string> = { home: "#10b981", draw: "#f59e0b", away: "#ef4444" };

export default function AnalystsPage() {
  const [analysts, setAnalysts]         = useState<Analyst[]>([]);
  const [matches, setMatches]           = useState<LiveMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<LiveMatch | null>(null);
  const [matchPredictions, setMatchPredictions] = useState<AnalystPrediction[]>([]);

  // Form state
  const [selectedAnalyst, setSelectedAnalyst] = useState("");
  const [outcome, setOutcome]           = useState<"home" | "draw" | "away" | "">("");
  const [confidence, setConfidence]     = useState(7);
  const [reasoning, setReasoning]       = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [submitMsg, setSubmitMsg]       = useState("");

  // Add analyst form
  const [newName, setNewName]           = useState("");
  const [newLeague, setNewLeague]       = useState("");
  const [addingAnalyst, setAddingAnalyst] = useState(false);
  const [showAddForm, setShowAddForm]   = useState(false);

  const fetchAnalysts = useCallback(async () => {
    const r = await fetch(`${API}/api/analysts`);
    const d = await r.json();
    setAnalysts(d.analysts ?? []);
  }, []);

  const fetchMatches = useCallback(async () => {
    const r = await fetch(`${API}/api/live/matches?limit=8`);
    const d = await r.json();
    setMatches(d.matches ?? []);
  }, []);

  const fetchMatchPredictions = useCallback(async (fixtureId: number) => {
    const r = await fetch(`${API}/api/analysts/match/${fixtureId}`);
    const d = await r.json();
    setMatchPredictions(d.predictions ?? []);
  }, []);

  useEffect(() => {
    fetchAnalysts();
    fetchMatches();
  }, [fetchAnalysts, fetchMatches]);

  useEffect(() => {
    if (selectedMatch) fetchMatchPredictions(selectedMatch.fixture_id);
  }, [selectedMatch, fetchMatchPredictions]);

  async function handleSubmitPrediction() {
    if (!selectedMatch || !selectedAnalyst || !outcome) return;
    setSubmitting(true);
    setSubmitMsg("");
    try {
      const r = await fetch(`${API}/api/analysts/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixture_id:  selectedMatch.fixture_id,
          analyst_id:  selectedAnalyst,
          outcome,
          confidence,
          reasoning,
        }),
      });
      const d = await r.json();
      if (r.ok) {
        setSubmitMsg("✅ " + d.message);
        setOutcome("");
        setReasoning("");
        fetchMatchPredictions(selectedMatch.fixture_id);
      } else {
        setSubmitMsg("❌ " + (d.detail ?? "שגיאה"));
      }
    } catch {
      setSubmitMsg("❌ שגיאת רשת");
    } finally {
      setSubmitting(false);
    }
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
        setNewName("");
        setNewLeague("");
        setShowAddForm(false);
        fetchAnalysts();
      }
    } finally {
      setAddingAnalyst(false);
    }
  }

  // Compute consensus for selected match
  const algo = selectedMatch?.prediction?.final;
  const consensusOutcome = matchPredictions.length > 0
    ? (() => {
        const votes: Record<string, number> = { home: 0, draw: 0, away: 0 };
        matchPredictions.forEach(p => {
          votes[p.predicted_outcome] = (votes[p.predicted_outcome] ?? 0) + p.confidence_level * p.win_rate;
        });
        const total = Object.values(votes).reduce((a, b) => a + b, 0);
        if (!total) return null;
        return Object.fromEntries(Object.entries(votes).map(([k, v]) => [k, v / total]));
      })()
    : null;

  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }}>

      {/* Navbar */}
      <nav style={{
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "16px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0,
        background: "rgba(11,14,20,0.95)", backdropFilter: "blur(12px)", zIndex: 50,
      }}>
        <a href="/" style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-0.5px", textDecoration: "none", direction: "ltr" }}>
          <span style={{ color: "#10b981" }}>360</span>
          <span style={{ color: "white" }}>SCOUT</span>
        </a>
        <div style={{ display: "flex", gap: 28 }}>
          {NAV.map(item => (
            <a key={item.label} href={item.href} style={{
              color: item.active ? "white" : "#64748b",
              fontSize: 14, fontWeight: item.active ? 600 : 400, textDecoration: "none",
            }}>{item.label}</a>
          ))}
        </div>
      </nav>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px" }}>

        {/* Hero */}
        <div style={{ marginBottom: 36, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 900, color: "white", margin: 0 }}>לוח אנליסטים 👥</h1>
            <p style={{ color: "#64748b", fontSize: 14, marginTop: 8 }}>
              הזן ניבויים ידניים · ראה השוואה מול האלגוריתם · מדד דיוק אישי
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(v => !v)}
            style={{
              background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)",
              color: "#10b981", borderRadius: 10, padding: "10px 20px",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>
            + הוסף אנליסט
          </button>
        </div>

        {/* Add Analyst Form */}
        {showAddForm && (
          <div style={{
            background: "#0F1318", border: "1px solid rgba(16,185,129,0.2)",
            borderRadius: 14, padding: 24, marginBottom: 32,
          }}>
            <h3 style={{ color: "white", fontWeight: 700, fontSize: 15, margin: "0 0 16px" }}>אנליסט חדש</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="שם האנליסט *"
                style={inputStyle}
              />
              <input
                value={newLeague}
                onChange={e => setNewLeague(e.target.value)}
                placeholder="התמחות (ליגה / ספורט)"
                style={inputStyle}
              />
              <button
                onClick={handleAddAnalyst}
                disabled={addingAnalyst || !newName.trim()}
                style={{
                  background: addingAnalyst || !newName.trim() ? "rgba(16,185,129,0.2)" : "#10b981",
                  color: "#0B0E14", borderRadius: 8, padding: "10px 20px",
                  fontWeight: 700, fontSize: 13, cursor: addingAnalyst ? "wait" : "pointer",
                  border: "none",
                }}>
                {addingAnalyst ? "..." : "שמור"}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 24 }}>

          {/* Left — Leaderboard */}
          <div>
            <div style={{
              background: "#0F1318", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16, overflow: "hidden",
            }}>
              <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <h2 style={{ color: "white", fontWeight: 800, fontSize: 14, margin: 0 }}>
                  🏆 לוח מובילים ({analysts.length})
                </h2>
              </div>
              {analysts.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#475569", fontSize: 13 }}>
                  עדיין אין אנליסטים — לחץ &ldquo;+ הוסף אנליסט&rdquo;
                </div>
              ) : analysts.map((a, i) => (
                <div
                  key={a.id}
                  onClick={() => setSelectedAnalyst(a.id)}
                  style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    cursor: "pointer",
                    background: selectedAnalyst === a.id ? "rgba(16,185,129,0.06)" : "transparent",
                    borderLeft: selectedAnalyst === a.id ? "3px solid #10b981" : "3px solid transparent",
                    transition: "background 0.15s",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ color: "#475569", fontSize: 12, fontWeight: 700, minWidth: 18 }}>
                        {i + 1}
                      </span>
                      <div>
                        <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{a.name}</div>
                        {a.expertise_league && (
                          <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{a.expertise_league}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "left" }}>
                      <div style={{
                        color: a.accuracy_pct >= 60 ? "#10b981" : a.accuracy_pct >= 50 ? "#f59e0b" : "#ef4444",
                        fontWeight: 900, fontSize: 18,
                      }}>
                        {a.accuracy_pct > 0 ? `${a.accuracy_pct}%` : "—"}
                      </div>
                      <div style={{ color: "#475569", fontSize: 10 }}>
                        {a.total_predictions} ניבויים
                      </div>
                    </div>
                  </div>
                  {a.total_predictions > 0 && (
                    <div style={{ marginTop: 8, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 99 }}>
                      <div style={{
                        height: "100%", width: `${a.accuracy_pct}%`,
                        background: a.accuracy_pct >= 60 ? "#10b981" : "#f59e0b",
                        borderRadius: 99, transition: "width 0.6s ease",
                      }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right — Match selector + predict + consensus */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Match selector */}
            <div style={{ background: "#0F1318", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20 }}>
              <h3 style={{ color: "white", fontWeight: 700, fontSize: 14, margin: "0 0 14px" }}>🎯 בחר משחק לניבוי</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                {matches.length === 0 ? (
                  <div style={{ color: "#475569", fontSize: 13, padding: "8px 0" }}>טוען משחקים...</div>
                ) : matches.map(m => (
                  <button
                    key={m.fixture_id}
                    onClick={() => setSelectedMatch(m)}
                    style={{
                      background: selectedMatch?.fixture_id === m.fixture_id ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.03)",
                      border: selectedMatch?.fixture_id === m.fixture_id ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 10, padding: "10px 14px",
                      textAlign: "right", cursor: "pointer",
                      transition: "all 0.15s",
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b", fontSize: 11 }}>{m.league}</span>
                      <span style={{ color: "#475569", fontSize: 11 }}>{m.match_date?.slice(0, 10)}</span>
                    </div>
                    <div style={{ color: "white", fontWeight: 700, fontSize: 13, marginTop: 4 }}>
                      {m.home_team} <span style={{ color: "#475569", fontWeight: 400 }}>נגד</span> {m.away_team}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Prediction form */}
            {selectedMatch && (
              <div style={{ background: "#0F1318", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20 }}>
                <h3 style={{ color: "white", fontWeight: 700, fontSize: 14, margin: "0 0 4px" }}>
                  ✏️ הזן ניבוי
                </h3>
                <p style={{ color: "#475569", fontSize: 12, margin: "0 0 16px" }}>
                  {selectedMatch.home_team} נגד {selectedMatch.away_team}
                </p>

                {/* Algorithm probs */}
                {algo && (
                  <div style={{
                    background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 14px",
                    marginBottom: 16, display: "flex", gap: 12,
                  }}>
                    <span style={{ color: "#475569", fontSize: 11, marginLeft: "auto" }}>אלגוריתם:</span>
                    {(["home", "draw", "away"] as const).map(o => (
                      <span key={o} style={{ fontSize: 12, color: OUTCOME_COLOR[o] }}>
                        {OUTCOME_HE[o]} {Math.round(algo[o] * 100)}%
                      </span>
                    ))}
                  </div>
                )}

                {/* Outcome buttons */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {(["home", "draw", "away"] as const).map(o => (
                    <button
                      key={o}
                      onClick={() => setOutcome(o)}
                      style={{
                        flex: 1, padding: "10px 0", borderRadius: 10,
                        border: outcome === o ? `1px solid ${OUTCOME_COLOR[o]}` : "1px solid rgba(255,255,255,0.1)",
                        background: outcome === o ? `${OUTCOME_COLOR[o]}18` : "transparent",
                        color: outcome === o ? OUTCOME_COLOR[o] : "#64748b",
                        fontWeight: 700, fontSize: 13, cursor: "pointer",
                        transition: "all 0.15s",
                      }}>
                      {OUTCOME_HE[o]}
                    </button>
                  ))}
                </div>

                {/* Confidence */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>רמת ביטחון</span>
                    <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{confidence}/10</span>
                  </div>
                  <input
                    type="range" min={1} max={10} value={confidence}
                    onChange={e => setConfidence(+e.target.value)}
                    style={{ width: "100%", accentColor: "#10b981" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                    <span style={{ color: "#374151", fontSize: 10 }}>ספק</span>
                    <span style={{ color: "#374151", fontSize: 10 }}>וודאי</span>
                  </div>
                </div>

                {/* Reasoning */}
                <textarea
                  value={reasoning}
                  onChange={e => setReasoning(e.target.value)}
                  placeholder="נימוק קצר (אופציונלי)..."
                  rows={2}
                  style={{
                    ...inputStyle, width: "100%", boxSizing: "border-box",
                    resize: "none", marginBottom: 12,
                  }}
                />

                {/* Analyst selector */}
                <select
                  value={selectedAnalyst}
                  onChange={e => setSelectedAnalyst(e.target.value)}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 14 }}>
                  <option value="">— בחר אנליסט —</option>
                  {analysts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>

                <button
                  onClick={handleSubmitPrediction}
                  disabled={!outcome || !selectedAnalyst || submitting}
                  style={{
                    width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
                    background: (!outcome || !selectedAnalyst || submitting) ? "rgba(16,185,129,0.2)" : "#10b981",
                    color: "#0B0E14", fontWeight: 800, fontSize: 14,
                    cursor: (!outcome || !selectedAnalyst || submitting) ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                  }}>
                  {submitting ? "שומר..." : "שלח ניבוי"}
                </button>

                {submitMsg && (
                  <div style={{ marginTop: 10, color: submitMsg.startsWith("✅") ? "#10b981" : "#ef4444", fontSize: 13, textAlign: "center" }}>
                    {submitMsg}
                  </div>
                )}
              </div>
            )}

            {/* Consensus panel */}
            {selectedMatch && (
              <div style={{ background: "#0F1318", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20 }}>
                <h3 style={{ color: "white", fontWeight: 700, fontSize: 14, margin: "0 0 16px" }}>
                  🤝 קונסנזוס — אנליסטים vs אלגוריתם
                </h3>

                {matchPredictions.length === 0 ? (
                  <div style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "12px 0" }}>
                    עדיין אין ניבויי אנליסטים למשחק זה
                  </div>
                ) : (
                  <>
                    {/* Analyst predictions list */}
                    <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                      {matchPredictions.map((p, i) => (
                        <div key={i} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "8px 12px", borderRadius: 8,
                          background: "rgba(255,255,255,0.03)",
                        }}>
                          <div>
                            <span style={{ color: "white", fontWeight: 600, fontSize: 13 }}>{p.name}</span>
                            {p.reasoning && (
                              <span style={{ color: "#475569", fontSize: 11, marginRight: 8 }}>· {p.reasoning}</span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ color: "#475569", fontSize: 11 }}>{p.confidence_level}/10</span>
                            <span style={{
                              color: OUTCOME_COLOR[p.predicted_outcome] ?? "white",
                              fontWeight: 700, fontSize: 13,
                              background: `${OUTCOME_COLOR[p.predicted_outcome] ?? "#fff"}18`,
                              border: `1px solid ${OUTCOME_COLOR[p.predicted_outcome] ?? "#fff"}40`,
                              borderRadius: 6, padding: "2px 8px",
                            }}>
                              {OUTCOME_HE[p.predicted_outcome] ?? p.predicted_outcome}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Consensus bars */}
                    {consensusOutcome && algo && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {(["home", "draw", "away"] as const).map(o => {
                          const analystPct = Math.round((consensusOutcome[o] ?? 0) * 100);
                          const algoPct    = Math.round(algo[o] * 100);
                          const agree      = Math.abs(analystPct - algoPct) <= 8;
                          return (
                            <div key={o}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ color: OUTCOME_COLOR[o], fontSize: 12, fontWeight: 700 }}>
                                  {OUTCOME_HE[o]}
                                </span>
                                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                  <span style={{ color: "#64748b", fontSize: 11 }}>
                                    אנליסטים <strong style={{ color: "white" }}>{analystPct}%</strong>
                                  </span>
                                  <span style={{ color: "#64748b", fontSize: 11 }}>
                                    אלגו <strong style={{ color: "#10b981" }}>{algoPct}%</strong>
                                  </span>
                                  <span style={{ fontSize: 10, color: agree ? "#10b981" : "#f59e0b" }}>
                                    {agree ? "✓ הסכמה" : "≠ פער"}
                                  </span>
                                </div>
                              </div>
                              <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 99, position: "relative" }}>
                                <div style={{
                                  position: "absolute", height: "100%",
                                  width: `${algoPct}%`, background: OUTCOME_COLOR[o],
                                  opacity: 0.3, borderRadius: 99,
                                }} />
                                <div style={{
                                  position: "absolute", height: "100%",
                                  width: `${analystPct}%`, background: OUTCOME_COLOR[o],
                                  borderRadius: 99,
                                }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, padding: "10px 14px",
  color: "white", fontSize: 13, outline: "none",
};
