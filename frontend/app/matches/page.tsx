"use client";

import { useState, useEffect, useCallback } from "react";
import { Info } from "lucide-react";
import FilterSortBar, { FilterState } from "@/components/FilterSortBar";
import { bestValueBet } from "@/lib/valueBets";
import AlgorithmBreakdownModal, { Prediction } from "@/components/AlgorithmBreakdownModal";
import TelegramCTABanner from "@/components/TelegramCTABanner";
import { useRequireAuth } from "@/hooks/useRequireAuth";

const API = "/api/backend";

// Tier 1 & Tier 2 whitelist — API-Football IDs (mirrors backend WHITELISTED_LEAGUE_IDS)
const MAJOR_LEAGUE_IDS = [2, 3, 4, 9, 39, 40, 61, 78, 88, 94, 135, 140, 253, 271, 307, 848];
const MAJOR_LEAGUE_KEYWORDS = [
  "champions", "premier", "liga", "serie a", "bundesliga", "ligue 1",
  "europa", "conference", "eredivisie", "primeira",
  "championship", "saudi", "mls", "ligat",
  "אלופות", "פרמייר", "אירופאית",
];

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
  odds?: { bookmaker?: string; odds_home?: number; odds_draw?: number; odds_away?: number } | null;
  goals_signal?: {
    line: number;
    over_prob: number;
    under_prob: number;
    over_odds: number;
    under_odds: number;
    over_edge: number;
    under_edge: number;
    signal: string;
    signal_edge: number;
  } | null;
}

const hasMarketOdds = (m: Match): boolean => !!(m.odds && m.odds.odds_home && m.odds.odds_home > 1);

const HIGH_CONF_THRESHOLD = 65;

function isMajorLeague(m: Match): boolean {
  if (m.league_id && MAJOR_LEAGUE_IDS.includes(m.league_id)) return true;
  const l = (m.league ?? "").toLowerCase();
  return MAJOR_LEAGUE_KEYWORDS.some(k => l.includes(k));
}

const OUTCOME_HE: Record<string, string> = { home: "בית", draw: "תיקו", away: "אורחים" };
const RATING_COLOR: Record<string, string> = { STRONG: "#10b981", MODERATE: "#f59e0b", WEAK: "#94a3b8" };
const CONSENSUS_COLOR: Record<string, string> = { LOCK: "#10b981", ALGORITHM_EDGE: "#f59e0b", DIVERGENCE: "#ef4444", ALGORITHM_ONLY: "#475569" };
const CONSENSUS_HE: Record<string, string> = { LOCK: "נעילה 🔒", ALGORITHM_EDGE: "יתרון אלגו", DIVERGENCE: "פער", ALGORITHM_ONLY: "אלגו בלבד" };

export default function MatchesPage() {
  useRequireAuth();
  const [matches, setMatches]     = useState<Match[]>([]);
  const [loading, setLoading]     = useState(true);
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    searchQuery: "",
    onlyValue: false,
    onlyConsensus: false,
    onlyWithOdds: false,
    leagueGroup: "ALL",
    sortBy: "TIME",
  });
  const [limit, setLimit]         = useState(20);
  const [modalMatch, setModalMatch] = useState<Match | null>(null);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/live/matches?limit=${limit}`, { cache: "no-store" });
      const d = await r.json();
      // dedupe — הפיד מחזיר לעיתים את אותו משחק פעמיים
      const seen = new Set<number>();
      setMatches((d.matches ?? []).filter((m: Match) => {
        if (seen.has(m.fixture_id)) return false;
        seen.add(m.fixture_id);
        return true;
      }));
    } catch { setMatches([]); }
    finally { setLoading(false); }
  }, [limit]);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  const valueBetCount = matches.filter(m => m.value_bets && Object.values(m.value_bets).some(v => v?.is_value_bet)).length;
  const lockCount     = matches.filter(m => m.consensus?.type === "LOCK").length;

  // filter
  const filtered = matches.filter(m => {
    const { searchQuery, onlyValue, onlyConsensus, onlyWithOdds, leagueGroup } = activeFilters;
    if (onlyWithOdds && !hasMarketOdds(m)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const hit = m.home_team?.toLowerCase().includes(q)
               || m.away_team?.toLowerCase().includes(q)
               || m.league?.toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (onlyValue    && !(m.value_bets && Object.values(m.value_bets).some(v => v?.is_value_bet))) return false;
    if (onlyConsensus && m.consensus?.type !== "LOCK") return false;
    if (leagueGroup === "MAJOR" && !isMajorLeague(m)) return false;
    if (leagueGroup === "MINOR" &&  isMajorLeague(m)) return false;
    return true;
  });

  // sort
  const sorted = [...filtered].sort((a, b) => {
    if (activeFilters.sortBy === "CONFIDENCE_DESC") return (b.prediction?.confidence ?? 0) - (a.prediction?.confidence ?? 0);
    if (activeFilters.sortBy === "TIME") return (a.match_date ?? "").localeCompare(b.match_date ?? "");
    if (activeFilters.sortBy === "VALUE_DESC") {
      const aEdge = Math.max(0, ...Object.values(a.value_bets ?? {}).map(v => v?.edge_percent ?? 0));
      const bEdge = Math.max(0, ...Object.values(b.value_bets ?? {}).map(v => v?.edge_percent ?? 0));
      return bEdge - aEdge;
    }
    return 0;
  });

  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }}>

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
        <FilterSortBar onFilterChange={setActiveFilters} />

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
                  display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1.4fr 1.4fr 1fr 1fr",
                  padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                }}>
                  {["משחק", "ליגה", "ביטחון", "חיזוי", "יחסים 1·X·2", "O/U 2.5", "Value Bet", "קונסנזוס"].map(h => (
                    <span key={h} style={{ color: "#475569", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>{h}</span>
                  ))}
                </div>

                {sorted.map((m, i) => {
                  const final   = m.prediction?.final ?? { home: 0, draw: 0, away: 0 };
                  const bestOut = Object.entries(final).sort((a, b) => b[1] - a[1])[0];
                  const vbEntry = bestValueBet(m.value_bets);

                  return (
                    <div key={m.fixture_id} style={{
                      display: "grid", gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1.4fr 1.4fr 1fr 1fr",
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

                      {/* יחסים 1·X·2 (decimal) */}
                      <div style={{ display: "flex", gap: 4, direction: "ltr" }}>
                        {(["odds_home", "odds_draw", "odds_away"] as const).map((k, idx) => {
                          const val = m.odds?.[k];
                          const label = ["1", "X", "2"][idx];
                          return (
                            <div key={k} style={{
                              textAlign: "center",
                              background: "rgba(255,255,255,0.04)",
                              borderRadius: 6, padding: "3px 5px", minWidth: 36,
                            }}>
                              <div style={{ fontSize: 8, color: "#475569", fontWeight: 700 }}>{label}</div>
                              <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: val ? "#cbd5e1" : "#334155" }}>
                                {val ? val.toFixed(2) : "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* O/U 2.5 */}
                      {m.goals_signal ? (() => {
                        const gs = m.goals_signal;
                        const sig = gs.signal === "over" ? "Over" : gs.signal === "under" ? "Under" : null;
                        const edge = gs.signal_edge;
                        const edgeColor = edge >= 15 ? "#10b981" : edge >= 5 ? "#f59e0b" : "#ef4444";
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {sig && (
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                                background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)",
                                color: "#a78bfa", width: "fit-content",
                              }}>
                                {sig} {gs.line} ▶ {edge >= 0 ? "+" : ""}{edge?.toFixed(1)}%
                              </span>
                            )}
                            <div style={{ display: "flex", gap: 3, direction: "ltr" }}>
                              <span style={{ fontSize: 9, color: "#64748b" }}>O {Math.round(gs.over_prob * 100)}%</span>
                              <span style={{ fontSize: 9, color: "#374151" }}>|</span>
                              <span style={{ fontSize: 9, color: "#64748b" }}>U {Math.round(gs.under_prob * 100)}%</span>
                            </div>
                          </div>
                        );
                      })() : (
                        <span style={{ color: "#374151", fontSize: 11 }}>—</span>
                      )}

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
                const vbEntry = bestValueBet(m.value_bets);

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

                    {/* Row 3: Prediction bars — direction:ltr so home (1) is LEFT, under the home team */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, direction: "ltr" }}>
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

                    {/* Row 4: Decimal odds (1 · X · 2) */}
                    {m.odds?.odds_home && (
                      <div style={{ display: "flex", gap: 6, marginBottom: 10, direction: "ltr" }}>
                        {(["odds_home", "odds_draw", "odds_away"] as const).map((k, idx) => {
                          const val = m.odds?.[k];
                          const label = ["1", "X", "2"][idx];
                          const vbKey = (["home", "draw", "away"] as const)[idx];
                          const isVB = !!m.value_bets?.[vbKey]?.is_value_bet;
                          return (
                            <div key={k} style={{
                              flex: 1, textAlign: "center",
                              background: isVB ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.03)",
                              border: `1px solid ${isVB ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.07)"}`,
                              borderRadius: 8, padding: "5px 4px",
                            }}>
                              <div style={{ fontSize: 9, color: "#475569", fontWeight: 700, marginBottom: 2 }}>{label}</div>
                              <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: isVB ? "#10b981" : val ? "#cbd5e1" : "#334155" }}>
                                {val ? val.toFixed(2) : "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Row 5: O/U 2.5 signal */}
                    {m.goals_signal && (() => {
                      const gs = m.goals_signal;
                      const sig = gs.signal === "over" ? "Over" : gs.signal === "under" ? "Under" : null;
                      const edge = gs.signal_edge;
                      return (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 10px", borderRadius: 8, marginBottom: 8,
                          background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)",
                          direction: "ltr",
                        }}>
                          <span style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700 }}>O/U 2.5</span>
                          <div style={{ display: "flex", gap: 4, flex: 1 }}>
                            {[
                              { label: `Over ${gs.line}`, prob: gs.over_prob, odds: gs.over_odds, isSignal: gs.signal === "over" },
                              { label: `Under ${gs.line}`, prob: gs.under_prob, odds: gs.under_odds, isSignal: gs.signal === "under" },
                            ].map(item => (
                              <div key={item.label} style={{
                                flex: 1, textAlign: "center", padding: "3px 6px", borderRadius: 6,
                                background: item.isSignal ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.03)",
                                border: `1px solid ${item.isSignal ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.06)"}`,
                              }}>
                                <div style={{ fontSize: 9, color: item.isSignal ? "#a78bfa" : "#475569", fontWeight: 700 }}>{item.label}</div>
                                <div style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: item.isSignal ? "#a78bfa" : "#64748b" }}>
                                  {item.odds ? item.odds.toFixed(2) : "—"}
                                </div>
                                <div style={{ fontSize: 9, color: "#475569" }}>{Math.round(item.prob * 100)}%</div>
                              </div>
                            ))}
                          </div>
                          {sig && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                              background: "rgba(167,139,250,0.18)", color: "#a78bfa",
                            }}>
                              {edge >= 0 ? "+" : ""}{edge?.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Row 6: Tags */}
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
