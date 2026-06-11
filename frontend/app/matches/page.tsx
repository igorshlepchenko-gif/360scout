"use client";

import { useState, useEffect, useCallback } from "react";
import { Info } from "lucide-react";
import FilterSortBar, { MatchFilter, MatchSort } from "@/components/FilterSortBar";
import AlgorithmBreakdownModal, { Prediction } from "@/components/AlgorithmBreakdownModal";
import TelegramCTABanner from "@/components/TelegramCTABanner";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ליגות בכירות — API-Football IDs
const MAJOR_LEAGUE_IDS = [1, 2, 3, 39, 140, 135, 78, 61];
const MAJOR_LEAGUE_KEYWORDS = ["champions", "premier", "liga", "serie a", "bundesliga", "ligue 1", "world cup", "מונדיאל", "אלופות", "פרמייר"];

interface Match {
  fixture_id: number;
  home_team: string;
  away_team: string;
  home_logo: string;
  away_logo: string;
  league: string;
  league_id?: number;
  league_logo: string;
  match_date: string;
  prediction: Prediction;
  value_bets: Record<string, { is_value_bet: boolean; rating: string; edge_percent: number; bookmaker_odds: number }> | null;
  consensus: { type: string };
  weather: { temperature_celsius: number; weather_condition: string; source: string };
}

const HIGH_CONF_THRESHOLD = 65;

function isMajorLeague(m: Match): boolean {
  if (m.league_id && MAJOR_LEAGUE_IDS.includes(m.league_id)) return true;
  const l = (m.league ?? "").toLowerCase();
  return MAJOR_LEAGUE_KEYWORDS.some(k => l.includes(k));
}

const NAV = [
  { label: "סיגנלים חמים",      href: "/" },
  { label: "כל המשחקים",        href: "/matches", active: true },
  { label: "ביצועים היסטוריים", href: "/track-record" },
  { label: "אנליסטים",          href: "/analysts" },
];

const OUTCOME_HE: Record<string, string> = { home: "בית", draw: "תיקו", away: "אורחים" };
const RATING_COLOR: Record<string, string> = { STRONG: "#10b981", MODERATE: "#f59e0b", WEAK: "#94a3b8" };
const CONSENSUS_COLOR: Record<string, string> = { LOCK: "#10b981", ALGORITHM_EDGE: "#f59e0b", DIVERGENCE: "#ef4444", ALGORITHM_ONLY: "#475569" };
const CONSENSUS_HE: Record<string, string> = { LOCK: "נעילה 🔒", ALGORITHM_EDGE: "יתרון אלגו", DIVERGENCE: "פער", ALGORITHM_ONLY: "אלגו בלבד" };

export default function MatchesPage() {
  const [matches, setMatches]     = useState<Match[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<MatchFilter>("all");
  const [sortBy, setSortBy]       = useState<MatchSort>("confidence");
  const [limit, setLimit]         = useState(20);
  const [modalMatch, setModalMatch] = useState<Match | null>(null);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/live/matches?limit=${limit}`, { cache: "no-store" });
      const d = await r.json();
      setMatches(d.matches ?? []);
    } catch { setMatches([]); }
    finally { setLoading(false); }
  }, [limit]);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  // filter
  const filtered = matches.filter(m => {
    if (filter === "value")     return m.value_bets && Object.values(m.value_bets).some(v => v?.is_value_bet);
    if (filter === "lock")      return m.consensus?.type === "LOCK";
    if (filter === "high_conf") return (m.prediction?.confidence ?? 0) >= HIGH_CONF_THRESHOLD;
    if (filter === "major")     return isMajorLeague(m);
    return true;
  });

  // sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "confidence") return (b.prediction?.confidence ?? 0) - (a.prediction?.confidence ?? 0);
    if (sortBy === "date")       return (a.match_date ?? "").localeCompare(b.match_date ?? "");
    if (sortBy === "edge") {
      const aEdge = Math.max(...Object.values(a.value_bets ?? {}).map(v => v?.edge_percent ?? 0));
      const bEdge = Math.max(...Object.values(b.value_bets ?? {}).map(v => v?.edge_percent ?? 0));
      return bEdge - aEdge;
    }
    return 0;
  });

  const valueBetCount = matches.filter(m => m.value_bets && Object.values(m.value_bets).some(v => v?.is_value_bet)).length;
  const lockCount     = matches.filter(m => m.consensus?.type === "LOCK").length;

  const counts = {
    all:       matches.length,
    value:     valueBetCount,
    lock:      lockCount,
    high_conf: matches.filter(m => (m.prediction?.confidence ?? 0) >= HIGH_CONF_THRESHOLD).length,
    major:     matches.filter(isMajorLeague).length,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }}>

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

      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: "white", margin: 0 }}>כל המשחקים ⚽</h1>
            <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
              {matches.length} משחקים · {valueBetCount} Value Bets · {lockCount} נעילות קונסנזוס
            </p>
          </div>
          <button onClick={fetchMatches} style={{
            background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
            color: "#10b981", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600,
          }}>🔄 רענן</button>
        </div>

        {/* Filters + Sort */}
        <FilterSortBar
          filter={filter}
          sort={sortBy}
          counts={counts}
          onFilter={setFilter}
          onSort={setSortBy}
        />

        {/* Telegram CTA */}
        <div style={{ marginBottom: 24 }}>
          <TelegramCTABanner variant="compact" />
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: "center", color: "#475569", padding: "60px 0", fontSize: 14 }}>
            טוען משחקים...
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: "center", color: "#475569", padding: "60px 0", fontSize: 14 }}>
            אין משחקים תואמים לפילטר הנבחר
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div style={{ display: "none" }} className="desktop-table">
              <div style={{
                background: "#0F1318", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 16, overflow: "hidden",
              }}>
                {/* Header */}
                <div style={{
                  display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1fr 1fr",
                  padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                }}>
                  {["משחק", "ליגה", "ביטחון", "חיזוי", "Value Bet", "קונסנזוס"].map(h => (
                    <span key={h} style={{ color: "#475569", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>{h}</span>
                  ))}
                </div>

                {sorted.map((m, i) => {
                  const final   = m.prediction?.final ?? { home: 0, draw: 0, away: 0 };
                  const bestOut = Object.entries(final).sort((a, b) => b[1] - a[1])[0];
                  const vbEntry = Object.entries(m.value_bets ?? {}).find(([, v]) => v?.is_value_bet);

                  return (
                    <div key={m.fixture_id} style={{
                      display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1fr 1fr",
                      padding: "14px 20px",
                      borderBottom: i < sorted.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      alignItems: "center",
                    }}>
                      {/* משחק */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, direction: "ltr" }}>
                        {m.home_logo && <img src={m.home_logo} width={20} height={20} style={{ objectFit: "contain" }} alt="" />}
                        <span style={{ color: "white", fontWeight: 600, fontSize: 13 }}>{m.home_team}</span>
                        <span style={{ color: "#475569", fontSize: 11 }}>vs</span>
                        {m.away_logo && <img src={m.away_logo} width={20} height={20} style={{ objectFit: "contain" }} alt="" />}
                        <span style={{ color: "white", fontWeight: 600, fontSize: 13 }}>{m.away_team}</span>
                        <span style={{ color: "#374151", fontSize: 11, marginLeft: 4 }}>{m.match_date?.slice(0, 10)}</span>
                      </div>

                      {/* ליגה */}
                      <span style={{ color: "#64748b", fontSize: 11 }}>{m.league?.slice(0, 20)}</span>

                      {/* ביטחון */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: "50%",
                          border: `2px solid ${m.prediction?.confidence >= 80 ? "#10b981" : m.prediction?.confidence >= 60 ? "#f59e0b" : "#ef4444"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 700,
                          color: m.prediction?.confidence >= 80 ? "#10b981" : m.prediction?.confidence >= 60 ? "#f59e0b" : "#ef4444",
                        }}>
                          {Math.round(m.prediction?.confidence ?? 0)}
                        </div>
                      </div>

                      {/* חיזוי */}
                      <div style={{ display: "flex", gap: 6 }}>
                        {(["home", "draw", "away"] as const).map(o => (
                          <span key={o} style={{
                            fontSize: 11, padding: "2px 6px", borderRadius: 6,
                            background: bestOut?.[0] === o ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                            color: bestOut?.[0] === o ? "#10b981" : "#64748b",
                            fontWeight: bestOut?.[0] === o ? 700 : 400,
                          }}>
                            {Math.round(final[o] * 100)}%
                          </span>
                        ))}
                      </div>

                      {/* Value Bet */}
                      {vbEntry ? (
                        <div>
                          <span style={{
                            fontSize: 11, fontWeight: 700,
                            color: RATING_COLOR[vbEntry[1]?.rating] ?? "#94a3b8",
                            background: `${RATING_COLOR[vbEntry[1]?.rating] ?? "#94a3b8"}18`,
                            border: `1px solid ${RATING_COLOR[vbEntry[1]?.rating] ?? "#94a3b8"}40`,
                            borderRadius: 6, padding: "2px 8px",
                          }}>
                            ⚡ {OUTCOME_HE[vbEntry[0]]} +{vbEntry[1]?.edge_percent?.toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "#374151", fontSize: 11 }}>—</span>
                      )}

                      {/* קונסנזוס */}
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: CONSENSUS_COLOR[m.consensus?.type] ?? "#475569",
                      }}>
                        {CONSENSUS_HE[m.consensus?.type] ?? "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sorted.map(m => {
                const final   = m.prediction?.final ?? { home: 0, draw: 0, away: 0 };
                const bestOut = Object.entries(final).sort((a, b) => b[1] - a[1])[0];
                const vbEntry = Object.entries(m.value_bets ?? {}).find(([, v]) => v?.is_value_bet);

                return (
                  <div key={m.fixture_id} style={{
                    background: "#0F1318", border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 14, padding: "16px",
                    borderLeft: vbEntry ? "3px solid #f59e0b" : m.consensus?.type === "LOCK" ? "3px solid #10b981" : "3px solid transparent",
                  }}>
                    {/* Row 1: Teams */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap", direction: "ltr" }}>
                      {m.home_logo && <img src={m.home_logo} width={22} height={22} style={{ objectFit: "contain" }} alt="" />}
                      <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{m.home_team}</span>
                      <span style={{ color: "#475569", fontSize: 12 }}>vs</span>
                      {m.away_logo && <img src={m.away_logo} width={22} height={22} style={{ objectFit: "contain" }} alt="" />}
                      <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{m.away_team}</span>
                      <span style={{ color: "#374151", fontSize: 11, marginLeft: "auto" }}>{m.match_date?.slice(0, 10)}</span>
                    </div>

                    {/* Row 2: League + Confidence */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ color: "#64748b", fontSize: 11 }}>{m.league?.slice(0, 30)}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                        background: "rgba(255,255,255,0.05)",
                        color: m.prediction?.confidence >= 80 ? "#10b981" : m.prediction?.confidence >= 60 ? "#f59e0b" : "#94a3b8",
                      }}>
                        {Math.round(m.prediction?.confidence ?? 0)}% ביטחון
                      </span>
                    </div>

                    {/* Row 3: Prediction bars */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                      {(["home", "draw", "away"] as const).map(o => (
                        <div key={o} style={{ flex: 1, textAlign: "center" }}>
                          <div style={{ height: 4, borderRadius: 99, marginBottom: 4, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                            <div style={{
                              height: "100%", width: `${Math.round(final[o] * 100)}%`,
                              background: bestOut?.[0] === o ? "#10b981" : "#374151",
                              borderRadius: 99,
                            }} />
                          </div>
                          <span style={{ color: bestOut?.[0] === o ? "#10b981" : "#64748b", fontSize: 11, fontWeight: bestOut?.[0] === o ? 700 : 400 }}>
                            {OUTCOME_HE[o]} {Math.round(final[o] * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Row 4: Tags */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {vbEntry && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                          background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
                          color: "#f59e0b",
                        }}>
                          ⚡ Value: {OUTCOME_HE[vbEntry[0]]} +{vbEntry[1]?.edge_percent?.toFixed(1)}%
                        </span>
                      )}
                      {m.consensus?.type && m.consensus.type !== "ALGORITHM_ONLY" && (
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                          background: `${CONSENSUS_COLOR[m.consensus.type]}18`,
                          border: `1px solid ${CONSENSUS_COLOR[m.consensus.type]}40`,
                          color: CONSENSUS_COLOR[m.consensus.type],
                        }}>
                          {CONSENSUS_HE[m.consensus.type]}
                        </span>
                      )}
                      {m.weather?.source === "live" && (
                        <span style={{ fontSize: 11, color: "#475569", padding: "2px 8px", borderRadius: 6, background: "rgba(255,255,255,0.03)" }}>
                          🌡️ {Math.round(m.weather.temperature_celsius)}°C
                        </span>
                      )}
                      {/* Why? — opens algorithm breakdown */}
                      <button
                        onClick={() => setModalMatch(m)}
                        className="mr-auto flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
                      >
                        <Info className="h-3 w-3" /> למה?
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more */}
            {limit <= matches.length && (
              <div style={{ textAlign: "center", marginTop: 24 }}>
                <button onClick={() => setLimit(l => l + 20)} style={{
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#94a3b8", borderRadius: 10, padding: "10px 28px", fontSize: 13, cursor: "pointer",
                }}>
                  טען עוד משחקים
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Algorithm breakdown modal */}
      <AlgorithmBreakdownModal
        open={modalMatch !== null}
        onClose={() => setModalMatch(null)}
        homeTeam={modalMatch?.home_team ?? ""}
        awayTeam={modalMatch?.away_team ?? ""}
        prediction={modalMatch?.prediction ?? {
          final: { home: 0, draw: 0, away: 0 },
          by_module: {
            stats: { home: 0, draw: 0, away: 0 },
            environment: { home: 0, draw: 0, away: 0 },
            human: { home: 0, draw: 0, away: 0 },
            psychology: { home: 0, draw: 0, away: 0 },
          },
          monte_carlo: { home: 0, draw: 0, away: 0, simulations: 0 },
          confidence: 0,
          key_factors: [],
        }}
      />
    </div>
  );
}
