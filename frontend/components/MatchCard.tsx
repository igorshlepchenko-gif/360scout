"use client";

import { useState, useEffect, useRef } from "react";
import { bestValueBet } from "@/lib/valueBets";

interface Prediction {
  final: { home: number; draw: number; away: number };
  active_modules?: string[];
  by_module: {
    stats:       { home: number; draw: number; away: number };
    environment: { home: number; draw: number; away: number };
    human:       { home: number; draw: number; away: number };
    psychology:  { home: number; draw: number; away: number };
  };
  monte_carlo: { home: number; draw: number; away: number; simulations: number };
  confidence:  number;
  key_factors: Array<{ factor: string; impact: string; detail: string }>;
}

interface ValueBets {
  home?: { is_value_bet: boolean; edge_percent: number; rating: string; bookmaker_odds: number; value: number };
  draw?: { is_value_bet: boolean; edge_percent: number; rating: string; bookmaker_odds: number; value: number };
  away?: { is_value_bet: boolean; edge_percent: number; rating: string; bookmaker_odds: number; value: number };
}

interface Consensus {
  type:      string;
  algorithm: { home: number; draw: number; away: number };
  analysts?: { home: number; draw: number; away: number };
  master:    { home: number; draw: number; away: number };
  algo_edge: number;
}

interface CrossCheckResult {
  original_confidence:   number;
  adjusted_confidence:   number;
  alignment_score:       number;
  expert_summary_hebrew: string;
  consensus_reached:     boolean;
  data_source:           string;
}

interface ConsensusMatchResult {
  our_pick:               string;
  consensus_rate:         number;
  agreeing_count:         string;
  avg_analysts_confidence: number;
  is_consensus_lock:      boolean;
  display_badge:          string;
  expert_advice:          string;
  is_demo:                boolean;
  data_source:            "demo" | "api-football" | "db";
  analysts: Array<{ name: string; pick: string; confidence: number }>;
}

interface MatchOdds {
  bookmaker?:  string;
  odds_home?:  number;
  odds_draw?:  number;
  odds_away?:  number;
}

interface LineupPlayer {
  name:   string | null;
  number: number | null;
  pos:    string | null;
}

interface LineupTeam {
  formation: string;
  startXI:   LineupPlayer[];
}

interface Lineups {
  home: LineupTeam | null;
  away: LineupTeam | null;
}

interface MatchWeather {
  temperature_celsius: number;
  weather_condition:   string;
  source:              string;
}

interface GoalsSignal {
  line:           number;
  xg_home:        number;
  xg_away:        number;
  expected_total: number;
  over_prob:      number;   // 0–1
  under_prob:     number;   // 0–1
  btts_yes_prob:  number;
  btts_no_prob:   number;
  over_odds:      number;
  under_odds:     number;
  over_edge:      number;   // EV% (e.g. 18.3)
  under_edge:     number;
  over_rating:    string;
  under_rating:   string;
  signal:         string;   // "OVER" | "UNDER" | "NO_SIGNAL"
  signal_edge:    number;
  signal_rating:  string;
  modifiers_applied: string[];
}

interface OuEdge {
  expected_goals:    number;
  true_under_prob:   number;  // 0–100
  true_over_prob:    number;  // 0–100
  under_edge:        number;
  over_edge:         number;
  under_rating:      string;
  over_rating:       string;
  bookie_under_odds: number;
  bookie_over_odds:  number;
  bookmaker?:        string;
}

interface HandicapSignal {
  triggered:      boolean;
  favorite:       "home" | "away";
  favorite_team:  string;
  underdog_team:  string;
  line:           number;   // -1.5
  xg_home:        number;
  xg_away:        number;
  cover_prob:     number;   // 0–1 — P(favourite wins by 2+)
  straight_win_prob: number; // 0–1 — P(favourite wins straight, any margin)
  straight_odds:  number;
  straight_edge:  number;   // EV% on the straight win
  ah_odds:        number | null;
  ah_fair_odds:   number;
  ah_edge:        number | null;
  ah_rating:      string;
  bookmaker:      string | null;
  is_safe_match:  boolean;
  is_high_margin: boolean;
  reasoning:      string;
}

interface MatchCardProps {
  homeTeam:     string;
  awayTeam:     string;
  homeLogo?:    string;
  awayLogo?:    string;
  league?:      string;
  leagueLogo?:  string;
  matchDate?:   string;
  isLive?:      boolean;
  prediction:   Prediction;
  value_bets?:  ValueBets;
  consensus?:   Consensus;
  fixtureId?:   number;
  matchId?:     string;
  odds?:        MatchOdds | null;
  weather?:     MatchWeather | null;
  xg?:          { home: number; away: number } | null;
  goals_signal?: GoalsSignal | null;
  ou_edge?:     OuEdge | null;
  handicap_signal?: HandicapSignal | null;
  lineups?:     Lineups | null;
}

const pct  = (n: number) => `${(n * 100).toFixed(1)}%`;
const pct0 = (n: number) => `${(n * 100).toFixed(0)}%`;

const FACTOR_LABELS: Record<string, { label: string; icon: string }> = {
  HEAVY_RAIN:           { label: "גשם כבד",            icon: "🌧" },
  EXTREME_HEAT:         { label: "חום קיצוני",          icon: "🌡" },
  HIGH_ALTITUDE:        { label: "גובה רב",             icon: "⛰" },
  HOME_KEY_INJURY:      { label: "פציעה מרכזית — בית",  icon: "🩹" },
  AWAY_KEY_INJURY:      { label: "פציעה מרכזית — אורחים", icon: "🩹" },
  STRICT_REFEREE:       { label: "שופט קשוח",           icon: "🟨" },
  ELIMINATION_PRESSURE: { label: "לחץ הכרעה",           icon: "⚡" },
  LONG_TRAVEL:          { label: "נסיעה ארוכה",         icon: "✈️" },
};

const CONSENSUS_CONFIG: Record<string, { border: string; badge: string; label: string }> = {
  LOCK:           { border: "border-emerald-500/40", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "🔒 קונסנזוס מלא" },
  ALGORITHM_EDGE: { border: "border-amber-500/40",   badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",     label: "⚡ יתרון אלגוריתם" },
  DIVERGENCE:     { border: "border-slate-500/30",   badge: "bg-slate-500/15 text-slate-400 border-slate-500/30",     label: "⚠ פיצול דעות" },
  ALGORITHM_ONLY: { border: "border-white/8",        badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",        label: "🤖 אלגוריתם" },
};

const OUTCOME_HE: Record<string, string> = { home: "בית", away: "אורחים", draw: "תיקו" };

// ===== Animated bar =====
function AnimatedBar({ value, color, delay = 0 }: { value: number; color: string; delay?: number }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(value * 100), delay + 100);
    return () => clearTimeout(t);
  }, [value, delay]);
  return (
    <div
      aria-hidden="true"
      className={`h-full ${color} rounded-full`}
      style={{ width: `${width}%`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }}
    />
  );
}

// ===== Team Logo =====
function TeamLogo({ logo, name, size = 40 }: { logo?: string; name: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (logo && !err) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={name}
        width={size}
        height={size}
        onError={() => setErr(true)}
        style={{ objectFit: "contain", filter: "drop-shadow(0 0 6px rgba(255,255,255,0.15))" }}
      />
    );
  }
  // Fallback: initials
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size,
      borderRadius: "50%",
      background: "rgba(255,255,255,0.08)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.35, fontWeight: 900, color: "white",
      border: "1px solid rgba(255,255,255,0.12)",
    }}>
      {initials}
    </div>
  );
}

// ===== Confidence Ring =====
function ConfidenceRing({ value }: { value: number }) {
  const r    = 22;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  const color = value > 75 ? "#10b981" : value > 55 ? "#f59e0b" : "#ef4444";

  return (
    <div
      role="img"
      aria-label={`רמת ביטחון: ${value}%`}
      style={{ position: "relative", width: 64, height: 64 }}
    >
      <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
        <circle
          cx="32" cy="32" r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease", filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <div
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 900, color }}>{value}%</div>
        <div style={{ fontSize: 8, color: "#64748b", marginTop: -2 }}>ביטחון</div>
      </div>
    </div>
  );
}

// ===== Module breakdown mini-chart =====
function ModuleChart({ modules, activeModules }: { modules: Prediction["by_module"]; activeModules?: string[] }) {
  const rows = [
    { key: "stats",       label: "סטטיסטיקה",   icon: "📊", home: modules.stats.home,       away: modules.stats.away },
    { key: "environment", label: "סביבה",        icon: "🌡", home: modules.environment.home,  away: modules.environment.away },
    { key: "human",       label: "פציעות/שופט",  icon: "🩹", home: modules.human.home,        away: modules.human.away },
    { key: "psychology",  label: "פסיכולוגיה",   icon: "🧠", home: modules.psychology.home,   away: modules.psychology.away },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map(row => {
        const isActive = !activeModules || activeModules.includes(row.key);
        const dimStyle = isActive ? {} : { opacity: 0.3 };
        return (
          // direction:ltr — HOME column always left, AWAY column always right
          <div key={row.key} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center", direction: "ltr", ...dimStyle }}>
            {/* HOME — left (green) */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "white", fontWeight: 600 }}>{pct0(row.home)}</span>
              <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${row.home * 100}%`, background: isActive ? "#10b981" : "#64748b", borderRadius: 99, transition: "width 0.8s ease" }} />
              </div>
            </div>
            {/* Label */}
            <div style={{ textAlign: "center", minWidth: 110 }}>
              <span style={{ fontSize: 10 }}>{row.icon}</span>
              <span style={{ fontSize: 10, color: "#64748b", marginRight: 4 }}>{row.label}</span>
              {!isActive && <span style={{ fontSize: 9, color: "#475569", marginRight: 2 }}>— אין נתונים</span>}
            </div>
            {/* AWAY — right (red) */}
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${row.away * 100}%`, background: isActive ? "#ef4444" : "#64748b", borderRadius: 99, transition: "width 0.8s ease" }} />
              </div>
              <span style={{ fontSize: 12, color: "white", fontWeight: 600 }}>{pct0(row.away)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== Value vs Market table (The Winning Method) =====
function WinningMethodTable({
  probs, odds, valueBets, homeTeam, awayTeam, xg,
}: {
  probs:     { home: number; draw: number; away: number };
  odds:      MatchOdds;
  valueBets?: ValueBets;
  homeTeam:  string;
  awayTeam:  string;
  xg?:       { home: number; away: number };
}) {
  const fairOdds = (p: number) => (p > 0 ? (1 / p).toFixed(2) : "—");

  const TH: React.CSSProperties = {
    padding: "10px 12px", fontSize: 10, fontWeight: 700,
    color: "#64748b", textAlign: "center", whiteSpace: "nowrap",
    background: "rgba(15,23,42,0.6)",
  };
  const TD: React.CSSProperties = {
    padding: "10px 12px", fontSize: 12, textAlign: "center",
    fontFamily: "monospace", color: "#cbd5e1",
  };
  const LABEL: React.CSSProperties = {
    padding: "10px 12px", fontSize: 11, fontWeight: 700,
    color: "#94a3b8", textAlign: "right",
  };
  const ROW_PROB: React.CSSProperties = { background: "rgba(56,189,248,0.06)" };
  const ROW_VALUE_ON: React.CSSProperties = { background: "rgba(74,222,128,0.08)" };

  const cols = [
    { sign: "1", label: homeTeam,  prob: probs.home, market: odds.odds_home, vb: valueBets?.home,  xgVal: xg?.home },
    { sign: "X", label: "תיקו",   prob: probs.draw, market: odds.odds_draw, vb: valueBets?.draw,  xgVal: undefined },
    { sign: "2", label: awayTeam, prob: probs.away, market: odds.odds_away, vb: valueBets?.away,  xgVal: xg?.away },
  ];

  const hasAnyValue = cols.some(c => c.vb?.is_value_bet);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ height: 14, width: 3, background: "#38bdf8", borderRadius: 99 }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: "#cbd5e1" }}>
          שיטת הניצחון — ניתוח מלא
        </span>
        {odds.bookmaker && (
          <span style={{ fontSize: 9, color: "#475569" }}>· {odds.bookmaker}</span>
        )}
      </div>

      <div style={{ border: "1px solid #334155", borderRadius: 10, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 340 }} dir="ltr">
          <caption className="sr-only">טבלת שיטת הניצחון — הסתברויות, יחסים הוגנים ויחסי שוק</caption>
          <thead>
            <tr style={{ borderBottom: "2px solid #38bdf8" }}>
              <th style={{ ...TH, textAlign: "right" }}>פרמטר</th>
              {cols.map(c => (
                <th key={c.sign} style={TH}>
                  {c.sign}<br />
                  <span style={{ fontSize: 9, fontWeight: 400, color: "#475569" }}>{c.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>

            {/* ── xG row (only when backend provides it) ── */}
            {xg && (
              <tr style={{ borderBottom: "1px solid #334155" }}>
                <td style={LABEL}>⚽ xG משוקלל</td>
                {cols.map(c => (
                  <td key={c.sign} style={TD}>
                    {c.xgVal != null ? c.xgVal.toFixed(2) : "—"}
                  </td>
                ))}
              </tr>
            )}

            {/* ── Probability row — blue ── */}
            <tr style={{ ...ROW_PROB, borderBottom: "1px solid #334155" }}>
              <td style={{ ...LABEL, color: "#38bdf8" }}>📊 הסתברות</td>
              {cols.map(c => (
                <td key={c.sign} style={{ ...TD, color: "#38bdf8", fontWeight: 700, fontSize: 14 }}>
                  {(c.prob * 100).toFixed(1)}%
                </td>
              ))}
            </tr>

            {/* ── Fair odds row ── */}
            <tr style={{ borderBottom: "1px solid #334155" }}>
              <td style={LABEL}>⚖️ יחס הוגן</td>
              {cols.map(c => (
                <td key={c.sign} style={{ ...TD, color: "#64748b" }}>
                  {fairOdds(c.prob)}
                </td>
              ))}
            </tr>

            {/* ── Market odds row ── */}
            <tr style={{ borderBottom: hasAnyValue ? "1px solid #334155" : "none" }}>
              <td style={LABEL}>💰 יחס שוק</td>
              {cols.map(c => (
                <td key={c.sign} style={TD}>
                  {c.market ? c.market.toFixed(2) : "—"}
                </td>
              ))}
            </tr>

            {/* ── Value row — green if any value found ── */}
            {hasAnyValue && (
              <tr style={ROW_VALUE_ON}>
                <td style={{ ...LABEL, color: "#4ade80" }}>⚡ ערך (Edge)</td>
                {cols.map(c => {
                  const isV = !!c.vb?.is_value_bet;
                  return (
                    <td key={c.sign} style={{
                      ...TD,
                      fontWeight: 700,
                      color: isV ? "#4ade80" : "#475569",
                    }}>
                      {isV ? `✅ +${c.vb!.edge_percent.toFixed(1)}%` : "—"}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ===== Over/Under 2.5 — compact always-visible row (card header) =====
// Columns: אופציה | הסתברות המודל | יחס עולמי | ערך | המלצה סופית
function OUWinningMethodRow({ gs }: { gs: GoalsSignal }) {
  const rows = [
    {
      label:    `אובר ${gs.line}`,
      emoji:    "🔼",
      prob:     gs.over_prob,
      odds:     gs.over_odds,
      edge:     gs.over_edge,
      isSignal: gs.signal === "OVER",
    },
    {
      label:    `אנדר ${gs.line}`,
      emoji:    "🔽",
      prob:     gs.under_prob,
      odds:     gs.under_odds,
      edge:     gs.under_edge,
      isSignal: gs.signal === "UNDER",
    },
  ];

  const TH: React.CSSProperties = {
    padding: "6px 8px", fontSize: 9, fontWeight: 700,
    color: "#00ffcc", textAlign: "center",
    background: "rgba(11,11,22,0.9)",
    whiteSpace: "nowrap",
  };
  const TD: React.CSSProperties = {
    padding: "6px 8px", fontSize: 11, textAlign: "center",
    fontFamily: "monospace", color: "#a0a0b8",
  };
  const LABEL: React.CSSProperties = {
    padding: "6px 8px", fontSize: 11, fontWeight: 700,
    color: "#a0a0b8", whiteSpace: "nowrap",
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <div style={{ height: 12, width: 3, background: "#00ffcc", borderRadius: 99 }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: "#a0a0b8" }}>
          The Winning Method — Over/Under {gs.line}
        </span>
        {gs.xg_home > 0 && gs.xg_away > 0 && (
          <span style={{ fontSize: 9, color: "#475569" }}>
            · xG מכויל: {gs.xg_home.toFixed(2)} — {gs.xg_away.toFixed(2)}
          </span>
        )}
      </div>
      <div style={{ border: "1px solid rgba(0,255,204,0.2)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }} dir="rtl">
          <caption className="sr-only">טבלת Over/Under — הסתברויות, יחסי שוק וערך מתמטי</caption>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(0,255,204,0.3)" }}>
              <th style={{ ...TH, textAlign: "right" }}>שוק הימורים</th>
              <th style={TH}>הסתברות המערכת</th>
              <th style={TH}>יחס עולמי</th>
              <th style={TH}>ערך מתמטי</th>
              <th style={TH}>סיכוי פגיעה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isValue = r.edge > 0;
              const rawValue = r.edge / 100;
              return (
                <tr key={r.label} style={{
                  background: isValue ? "rgba(0,255,204,0.06)" : undefined,
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  {/* שוק */}
                  <td style={{
                    ...LABEL,
                    color: r.isSignal ? "#00ffcc" : isValue ? "#00ffcc" : "#a0a0b8",
                  }}>
                    {r.emoji} {r.label}
                    {r.isSignal && (
                      <span style={{
                        fontSize: 8, marginRight: 6,
                        background: "#00ffcc", color: "#0f0f1e",
                        borderRadius: 4, padding: "1px 5px", fontWeight: 800,
                      }}>VALUE מנצח</span>
                    )}
                  </td>
                  {/* הסתברות המערכת */}
                  <td style={{ ...TD, color: "#00ffcc", fontWeight: 700, fontSize: 13 }}>
                    {(r.prob * 100).toFixed(1)}%
                  </td>
                  {/* יחס עולמי */}
                  <td style={{ ...TD, fontWeight: 600, color: "#a0a0b8" }}>
                    {r.odds > 0 ? r.odds.toFixed(2) : "—"}
                  </td>
                  {/* ערך מתמטי */}
                  <td style={{
                    ...TD, fontWeight: 700,
                    color: isValue ? "#00ffcc" : "#ff4d4d",
                  }}>
                    {rawValue >= 0 ? `+${rawValue.toFixed(2)}` : rawValue.toFixed(2)}
                  </td>
                  {/* סיכוי פגיעה */}
                  <td style={{ ...TD }}>
                    {isValue ? (
                      <span style={{ color: "#00ffcc", fontWeight: 700, fontSize: 10 }}>
                        🟢 פוטנציאל רווח גבוה
                      </span>
                    ) : (
                      <span style={{ color: "#ff4d4d", opacity: 0.7, fontSize: 10 }}>
                        ❌ אין ערך בשוק
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== Asian Handicap — "Safe Match" shift (The Winning Method) =====
function AsianHandicapRow({ hs }: { hs: HandicapSignal }) {
  const favLabel = hs.favorite === "home" ? "בית" : "אורחים";
  const rows = [
    {
      label: `1X2 ישיר (${favLabel})`,
      emoji: "🔒",
      prob:  hs.straight_win_prob,
      odds:  hs.straight_odds,
      edge:  hs.straight_edge,
      note:  "ערך נמוך — כבר מתומחר",
    },
    {
      label: `אסיאן הנדיקאפ ${hs.line}`,
      emoji: "🎯",
      prob:  hs.cover_prob,
      odds:  hs.ah_odds ?? hs.ah_fair_odds,
      edge:  hs.ah_edge,
      note:  hs.ah_odds ? undefined : "יחס משוער — לא נמצא קו בשוק",
    },
  ];

  const TH: React.CSSProperties = {
    padding: "6px 8px", fontSize: 9, fontWeight: 700,
    color: "#fb923c", textAlign: "center",
    background: "rgba(11,11,22,0.9)",
    whiteSpace: "nowrap",
  };
  const TD: React.CSSProperties = {
    padding: "6px 8px", fontSize: 11, textAlign: "center",
    fontFamily: "monospace", color: "#a0a0b8",
  };
  const LABEL: React.CSSProperties = {
    padding: "6px 8px", fontSize: 11, fontWeight: 700,
    color: "#a0a0b8", whiteSpace: "nowrap",
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
        flexWrap: "wrap",
      }}>
        <div style={{ height: 12, width: 3, background: "#fb923c", borderRadius: 99 }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: "#a0a0b8" }}>
          The Winning Method — Asian Handicap {hs.line}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 800, color: "#fb923c",
          background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)",
          borderRadius: 99, padding: "1px 8px",
        }}>
          המלצה הוסטה: {hs.favorite_team} {hs.line}
        </span>
      </div>

      <div style={{ border: "1px solid rgba(251,146,60,0.25)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }} dir="rtl">
          <caption className="sr-only">
            טבלת השוואה — ניצחון ישיר מול אסיאן הנדיקאפ: הסתברויות, יחסים וערך מתמטי
          </caption>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(251,146,60,0.3)" }}>
              <th style={{ ...TH, textAlign: "right" }}>שוק</th>
              <th style={TH}>הסתברות המערכת</th>
              <th style={TH}>יחס</th>
              <th style={TH}>ערך מתמטי</th>
              <th style={TH}>הערה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const hasEdge  = r.edge !== null && r.edge !== undefined;
              const isValue  = hasEdge && (r.edge as number) > 0;
              const rawValue = hasEdge ? (r.edge as number) / 100 : null;
              return (
                <tr key={r.label} style={{
                  background: isValue ? "rgba(251,146,60,0.06)" : undefined,
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <td style={{ ...LABEL, color: isValue ? "#fb923c" : "#a0a0b8" }}>
                    {r.emoji} {r.label}
                  </td>
                  <td style={{ ...TD, color: "#fb923c", fontWeight: 700, fontSize: 13 }}>
                    {(r.prob * 100).toFixed(1)}%
                  </td>
                  <td style={{ ...TD, fontWeight: 600, color: "#a0a0b8" }}>
                    {r.odds > 0 ? r.odds.toFixed(2) : "—"}
                  </td>
                  <td style={{
                    ...TD, fontWeight: 700,
                    color: !hasEdge ? "#64748b" : isValue ? "#fb923c" : "#ff4d4d",
                  }}>
                    {rawValue === null ? "—" : rawValue >= 0 ? `+${rawValue.toFixed(2)}` : rawValue.toFixed(2)}
                  </td>
                  <td style={{ ...TD, fontSize: 9, color: "#64748b" }}>
                    {r.note ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 10.5, color: "#94a3b8", lineHeight: 1.5, marginTop: 6, marginBottom: 0 }}>
        {hs.reasoning}
      </p>
    </div>
  );
}

// ===== Decimal Odds Strip (always visible) =====
function OddsStrip({ odds, valueBets }: { odds: MatchOdds; valueBets?: ValueBets }) {
  const items = [
    { sign: "1", val: odds.odds_home, vb: valueBets?.home },
    { sign: "X", val: odds.odds_draw, vb: valueBets?.draw },
    { sign: "2", val: odds.odds_away, vb: valueBets?.away },
  ];
  if (!odds.odds_home && !odds.odds_away) return null;
  return (
    <div style={{
      display: "flex", gap: 6, direction: "ltr",
      marginTop: 8, padding: "6px 0 2px",
    }}>
      {items.map(item => {
        const isValue = !!item.vb?.is_value_bet;
        return (
          <div key={item.sign} style={{
            flex: 1, textAlign: "center",
            background: isValue ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${isValue ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.07)"}`,
            borderRadius: 8, padding: "5px 4px",
          }}>
            <div style={{ fontSize: 9, color: "#475569", fontWeight: 700, marginBottom: 2 }}>{item.sign}</div>
            <div style={{
              fontSize: 13, fontWeight: 800, fontFamily: "monospace",
              color: isValue ? "#10b981" : item.val ? "#cbd5e1" : "#334155",
            }}>
              {item.val ? item.val.toFixed(2) : "—"}
            </div>
            {isValue && (
              <div style={{ fontSize: 8, color: "#10b981", marginTop: 1 }}>
                +{item.vb!.edge_percent.toFixed(1)}%
              </div>
            )}
          </div>
        );
      })}
      {odds.bookmaker && (
        <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
          <span style={{ fontSize: 8, color: "#334155" }}>{odds.bookmaker}</span>
        </div>
      )}
    </div>
  );
}

const POS_HE: Record<string, string> = { G: "שוע", D: "הגנ", M: "קישור", F: "התקפ" };

// ===== Lineup Display =====
function LineupDisplay({ lineups, homeTeam, awayTeam }: { lineups: Lineups; homeTeam: string; awayTeam: string }) {
  const { home, away } = lineups;
  if (!home && !away) return null;

  function PlayerList({ team, side }: { team: LineupTeam; side: "home" | "away" }) {
    const isHome = side === "home";
    const accentColor = isHome ? "#10b981" : "#ef4444";
    const byPos: Record<string, LineupPlayer[]> = {};
    for (const p of team.startXI) {
      const pos = p.pos ?? "?";
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push(p);
    }
    const posOrder = ["G", "D", "M", "F"];
    const sorted = [
      ...posOrder.flatMap(p => byPos[p] ?? []),
      ...(team.startXI.filter(p => !posOrder.includes(p.pos ?? ""))),
    ];
    return (
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, justifyContent: isHome ? "flex-start" : "flex-end" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: accentColor }}>{isHome ? homeTeam : awayTeam}</span>
          <span style={{
            fontSize: 9, fontWeight: 700, color: accentColor,
            background: `${accentColor}18`, border: `1px solid ${accentColor}40`,
            borderRadius: 99, padding: "1px 7px",
          }}>{team.formation}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {sorted.map((p, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 4,
              flexDirection: isHome ? "row" : "row-reverse",
              padding: "2px 0",
            }}>
              <span style={{
                fontSize: 9, fontWeight: 700, color: "#334155",
                minWidth: 18, textAlign: "center",
              }}>{p.number ?? ""}</span>
              <span style={{ fontSize: 10, color: "#94a3b8", flex: 1, textAlign: isHome ? "left" : "right" }}>
                {p.name ?? "—"}
              </span>
              {p.pos && (
                <span style={{
                  fontSize: 8, color: "#475569",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 4, padding: "1px 4px", whiteSpace: "nowrap",
                }}>
                  {POS_HE[p.pos] ?? p.pos}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ height: 14, width: 3, background: "#64748b", borderRadius: 99 }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: "#cbd5e1" }}>הרכבי פתיחה</span>
      </div>
      <div style={{
        border: "1px solid #1e293b", borderRadius: 10,
        padding: "10px 12px",
        display: "flex", gap: 12, direction: "ltr",
      }}>
        {home && <PlayerList team={home} side="home" />}
        {home && away && (
          <div style={{ width: 1, background: "#1e293b", flexShrink: 0, alignSelf: "stretch" }} />
        )}
        {away && <PlayerList team={away} side="away" />}
      </div>
    </div>
  );
}

// ── Phenomenal Winning Method Panel — premium expanded O/U analysis ──────────
// Implements the full "generate_phenomenal_ui" HTML/CSS spec in React.
// Design: dark container #1a1a2e, teal #16a085 accent, 5-column table,
//         full-row green glow when edge > 0, 🟢/🔴 recommendation chips.
function PhenomenalWinningMethodPanel({
  gs, ouEdge, homeTeam, awayTeam,
}: {
  gs:        GoalsSignal | null;
  ouEdge:    OuEdge | null;
  homeTeam:  string;
  awayTeam:  string;
}) {
  const hasGs = !!gs;

  const line      = gs?.line ?? 2.5;
  const xgHome    = gs?.xg_home       ?? null;
  const xgAway    = gs?.xg_away       ?? null;
  const xgTotal   = gs?.expected_total ?? ouEdge?.expected_goals ?? null;
  const bttsYes   = gs ? gs.btts_yes_prob * 100 : null;
  const mods      = gs?.modifiers_applied ?? [];
  const signal    = gs?.signal      ?? "NO_SIGNAL";
  const sigEdge   = gs?.signal_edge ?? 0;
  const sigRat    = gs?.signal_rating ?? "NONE";

  const rows = [
    {
      key: "under", label: `Under ${line} שערים`, emoji: "🔽",
      prob: hasGs ? gs!.under_prob * 100 : (ouEdge?.true_under_prob ?? 0),
      odds: hasGs ? gs!.under_odds       : (ouEdge?.bookie_under_odds ?? 0),
      edge: hasGs ? gs!.under_edge       : (ouEdge?.under_edge ?? 0),
      isSignal: signal === "UNDER",
    },
    {
      key: "over", label: `Over ${line} שערים`, emoji: "🔼",
      prob: hasGs ? gs!.over_prob * 100 : (ouEdge?.true_over_prob ?? 0),
      odds: hasGs ? gs!.over_odds       : (ouEdge?.bookie_over_odds ?? 0),
      edge: hasGs ? gs!.over_edge       : (ouEdge?.over_edge ?? 0),
      isSignal: signal === "OVER",
    },
  ];

  const TH: React.CSSProperties = {
    padding: "18px 14px", fontSize: 13, fontWeight: 700,
    color: "#00ffcc", textAlign: "center",
    background: "#0b0b16", whiteSpace: "nowrap",
  };
  const TD: React.CSSProperties = {
    padding: "18px 14px", fontSize: 14, textAlign: "center",
    fontFamily: "monospace", color: "#a0a0b8",
  };
  const LABEL_COL: React.CSSProperties = {
    padding: "18px 14px", fontSize: 14, fontWeight: 700,
    color: "#a0a0b8", textAlign: "right", whiteSpace: "nowrap",
  };

  return (
    <div style={{
      background: "linear-gradient(145deg, #0f0f1e, #1a1a2e)",
      border: "1px solid #23233e",
      borderRadius: 16,
      boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
      overflow: "hidden",
      marginTop: 14,
      direction: "rtl",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid #2a2a4a",
        padding: "15px 20px",
      }}>
        <div>
          <span style={{ fontSize: 22, fontWeight: 900, color: "#00ffcc", letterSpacing: 1 }}>
            ANALYST365
          </span>
          {" "}
          <span style={{
            background: "#16a085", color: "white",
            padding: "3px 10px", borderRadius: 20,
            fontSize: 11, fontWeight: 700,
          }}>
            The Winning Method עולמי
          </span>
        </div>
        <div style={{ textAlign: "left", fontSize: 13, color: "#a0a0b8", fontWeight: 700 }}>
          {homeTeam} vs {awayTeam}
          {xgHome != null && xgAway != null && (
            <div style={{ fontSize: 10, color: "#475569", marginTop: 2, fontWeight: 400 }}>
              xG מכויל: {xgHome.toFixed(2)} — {xgAway.toFixed(2)}
              {mods.length > 0 && ` · ${mods.length} מגבירים`}
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }} dir="rtl">
          <caption className="sr-only">The Winning Method — ניתוח Over/Under פנומנלי: הסתברויות, יחסים וערך מתמטי</caption>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: "right" }}>שוק הימורים</th>
              <th style={TH}>הסתברות המערכת הפנומנלית</th>
              <th style={TH}>יחס עולמי ממוצע</th>
              <th style={TH}>ערך מתמטי (Value)</th>
              <th style={TH}>סיכוי פגיעה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isValue  = r.edge > 0;
              const rawValue = r.edge / 100;
              return (
                <tr
                  key={r.key}
                  style={{
                    background: isValue ? "rgba(0,255,204,0.06)" : undefined,
                    borderBottom: "1px solid #22223b",
                    transition: "background 0.2s",
                  }}
                >
                  {/* שוק */}
                  <td style={{ ...LABEL_COL, color: isValue ? "#00ffcc" : "#a0a0b8" }}>
                    {r.emoji} {r.label}
                    {r.isSignal && (
                      <span style={{
                        marginRight: 8, fontSize: 11, fontWeight: 800,
                        background: "#00ffcc", color: "#0f0f1e",
                        padding: "3px 8px", borderRadius: 4,
                      }}>
                        VALUE מנצח
                      </span>
                    )}
                  </td>
                  {/* הסתברות */}
                  <td style={{ ...TD, color: "#00ffcc", fontWeight: 700, fontSize: 18 }}>
                    {r.prob.toFixed(1)}%
                  </td>
                  {/* יחס עולמי */}
                  <td style={{ ...TD, color: "#a0a0b8" }}>
                    {r.odds > 0 ? r.odds.toFixed(2) : "—"}
                  </td>
                  {/* ערך מתמטי */}
                  <td style={{
                    ...TD, fontWeight: 800, fontSize: 18,
                    color: isValue ? "#00ffcc" : "#ff4d4d",
                    opacity: isValue ? 1 : 0.6,
                  }}>
                    {rawValue >= 0 ? `+${rawValue.toFixed(2)}` : rawValue.toFixed(2)}
                  </td>
                  {/* סיכוי פגיעה */}
                  <td style={{ ...TD }}>
                    {isValue ? (
                      <span style={{ color: "#00ffcc", fontWeight: 700, fontSize: 13 }}>
                        🟢 פוטנציאל רווח גבוה
                      </span>
                    ) : (
                      <span style={{ color: "#ff4d4d", opacity: 0.6, fontSize: 13 }}>
                        ❌ אין ערך בשוק
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer: xG team split + BTTS ── */}
      {(xgHome != null || bttsYes != null) && (
        <div style={{
          padding: "8px 20px",
          background: "rgba(0,0,0,0.3)",
          borderTop: "1px solid rgba(0,255,204,0.1)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 10, color: "#64748b", direction: "ltr",
        }}>
          {xgHome != null && xgAway != null ? (
            <span>
              ⚽ xG: <b style={{ color: "#a0a0b8" }}>{homeTeam}</b> {xgHome.toFixed(2)}
              {" · "}<b style={{ color: "#a0a0b8" }}>{awayTeam}</b> {xgAway.toFixed(2)}
              {" · "}סה&quot;כ: <b style={{ color: "#bdc3c7" }}>{xgTotal?.toFixed(2)}</b>
            </span>
          ) : <span />}
          {bttsYes != null && (
            <span>BTTS: <b style={{ color: "#a0a0b8" }}>{bttsYes.toFixed(0)}%</b></span>
          )}
        </div>
      )}

      {/* ── Best signal bar ── */}
      {signal !== "NO_SIGNAL" && (
        <div style={{
          margin: "10px 14px 0",
          background: "rgba(0,255,204,0.07)",
          border: "1px solid rgba(0,255,204,0.25)",
          borderRadius: 8, padding: "8px 16px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          direction: "ltr",
        }}>
          <span style={{ fontSize: 12, color: "#a0a0b8" }}>
            🎯 {signal === "OVER" ? `Over ${line}` : `Under ${line}`} — VALUE BET
          </span>
          <span style={{ fontSize: 14, fontWeight: 900, color: "#00ffcc" }}>
            +{(sigEdge / 100).toFixed(2)} · {sigRat}
          </span>
        </div>
      )}

      {/* ── Active modifiers chips ── */}
      {mods.length > 0 && (
        <div style={{
          padding: "8px 14px 12px",
          marginTop: signal !== "NO_SIGNAL" ? 8 : 0,
          display: "flex", gap: 4, flexWrap: "wrap",
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          {mods.map((m, i) => (
            <span key={i} style={{
              fontSize: 9, color: "#00ffcc",
              background: "rgba(0,255,204,0.06)",
              border: "1px solid rgba(0,255,204,0.18)",
              borderRadius: 99, padding: "2px 7px",
            }}>
              ⚡ {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MatchCard({
  homeTeam, awayTeam, homeLogo, awayLogo, league, leagueLogo,
  matchDate, isLive = false,
  prediction, value_bets, consensus,
  fixtureId, matchId, odds, weather, xg,
  goals_signal, ou_edge, handicap_signal, lineups,
}: MatchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [crossCheck, setCrossCheck]               = useState<CrossCheckResult | null>(null);
  const [crossCheckLoading, setCrossCheckLoading] = useState(false);
  const [consensusData, setConsensusData]         = useState<ConsensusMatchResult | null>(null);
  const [consensusLoading, setConsensusLoading]   = useState(false);

  const topOutcome = (Object.entries(prediction.final) as [string, number][])
    .sort((a, b) => b[1] - a[1])[0][0];

  const OUTCOME_12X: Record<string, string> = { home: "1", draw: "X", away: "2" };
  const PICK_HE: Record<string, string> = { "1": "ניצחון ביתי", "X": "תיקו", "2": "ניצחון אורחים" };

  // Auto-fetch when user expands the card for the first time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (expanded && !consensusData && !consensusLoading) runConsensusCheck();
  }, [expanded]);

  async function runConsensusCheck() {
    setConsensusLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/matches/consensus-match`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id:        matchId ?? `${homeTeam}-${awayTeam}`,
          home_team:       homeTeam,
          away_team:       awayTeam,
          our_prediction:  OUTCOME_12X[topOutcome] ?? "1",
          our_probability: prediction.final[topOutcome as keyof typeof prediction.final],
          fixture_id:      fixtureId ?? null,
        }),
      });
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      if (!data.analysts) throw new Error("missing analysts");
      setConsensusData(data);
    } catch { /* silent */ }
    finally { setConsensusLoading(false); }
  }

  async function runCrossCheck() {
    setCrossCheckLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/matches/cross-check`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_id:        matchId ?? `${homeTeam}-${awayTeam}`,
          home_team:       homeTeam,
          away_team:       awayTeam,
          base_confidence: prediction.confidence,
          prediction:      topOutcome,
          fixture_id:      fixtureId ?? null,
        }),
      });
      setCrossCheck(await res.json());
    } catch { /* silent */ }
    finally { setCrossCheckLoading(false); }
  }

  const displayProbs = consensus?.master ?? prediction.final;
  const anyValueBet  = Object.values(value_bets ?? {}).some(v => v?.is_value_bet);
  const bestVB       = bestValueBet(value_bets);   // הגבוה ביותר, לא הראשון
  const cfg          = CONSENSUS_CONFIG[consensus?.type ?? "ALGORITHM_ONLY"] ?? CONSENSUS_CONFIG.ALGORITHM_ONLY;

  const homeWin    = displayProbs.home > displayProbs.away && displayProbs.home > displayProbs.draw;
  const awayWin    = displayProbs.away > displayProbs.home && displayProbs.away > displayProbs.draw;
  const isWorldCup = /world.?cup|fifa|מונדיאל/i.test(league ?? "");

  // Monte Carlo leader — show whichever outcome has higher MC probability
  const mcHome      = prediction.monte_carlo.home;
  const mcAway      = prediction.monte_carlo.away;
  const mcLeader    = mcHome >= mcAway ? "home" : "away";
  const mcLeaderPct = mcLeader === "home" ? mcHome : mcAway;
  const mcLeaderLabel = mcLeader === "home" ? "MC בית" : "MC אורחים";
  const mcLeaderColor = mcLeader === "home" ? "#10b981" : "#ef4444";

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl border overflow-hidden transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl ${cfg.border}`}
      style={{ background: "#0F1318", boxShadow: anyValueBet ? "0 0 30px rgba(16,185,129,0.08)" : undefined }}
    >
      {/* ── LIVE INDICATOR ── */}
      {isLive && (
        <div
          role="status"
          aria-label="משחק מתקיים כרגע בשידור חי"
          style={{ background: "rgba(239,68,68,0.12)", borderBottom: "1px solid rgba(239,68,68,0.2)", padding: "6px 20px", display: "flex", alignItems: "center", gap: 8 }}
        >
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 1.5s infinite", boxShadow: "0 0 6px #ef4444" }} />
          <span aria-hidden="true" style={{ color: "#ef4444", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>LIVE</span>
        </div>
      )}

      {/* ── HEADER ── */}
      <div style={{ padding: "16px 20px 14px" }}>

        {/* ── Meta row: league (left) + date (right) ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          {league && (
            isWorldCup ? (
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                background: "linear-gradient(90deg, rgba(234,179,8,0.15), rgba(251,191,36,0.08))",
                border: "1px solid rgba(234,179,8,0.35)",
                borderRadius: 99, padding: "3px 10px", color: "#fbbf24",
              }}>🏆 גביע העולם 2026</span>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {leagueLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={leagueLogo} alt={league} width={12} height={12}
                    style={{ objectFit: "contain", opacity: 0.6 }} />
                )}
                <span style={{ fontSize: 10, color: "#475569" }}>{league}</span>
              </div>
            )
          )}
          {matchDate && (
            <span style={{ fontSize: 10, color: "#334155", direction: "ltr" }}>
              {matchDate.split(" ")[0]} {matchDate.split(" ")[1]}
            </span>
          )}
        </div>

        {/* ── Consensus badge on its own row ── */}
        <div style={{ marginBottom: 10 }}>
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
            {cfg.label}
          </span>
        </div>

        {/* ── SCOREBOARD ROW: Home | VS+Confidence | Away ── */}
        {/* direction:ltr — home is always LEFT, away always RIGHT */}
        <div className="match-scoreboard" style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          direction: "ltr",
        }}>

          {/* HOME — left */}
          <div className="team-col team-home" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <TeamLogo logo={homeLogo} name={homeTeam} size={44} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.2, color: "#10b981", maxWidth: 110 }}>
                {homeTeam}
              </div>
              <div style={{ fontSize: 9, color: "#10b981", opacity: 0.7, marginTop: 2, fontWeight: 600, letterSpacing: 0.5 }}>בית</div>
            </div>
          </div>

          {/* CENTER — VS separator + confidence dot */}
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ color: "#334155", fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>VS</div>
            <div style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "rgba(255,255,255,0.04)", borderRadius: 99, padding: "3px 9px",
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                background: prediction.confidence > 75 ? "#10b981" : prediction.confidence > 55 ? "#f59e0b" : "#ef4444",
                boxShadow: `0 0 4px ${prediction.confidence > 75 ? "#10b981" : prediction.confidence > 55 ? "#f59e0b" : "#ef4444"}`,
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: prediction.confidence > 75 ? "#10b981" : prediction.confidence > 55 ? "#f59e0b" : "#ef4444",
              }}>{prediction.confidence}%</span>
              <span style={{ fontSize: 8, color: "#475569" }}>ביטחון</span>
            </div>
          </div>

          {/* AWAY — right */}
          <div className="team-col team-away" style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.2, color: "#ef4444", maxWidth: 110 }}>
                {awayTeam}
              </div>
              <div style={{ fontSize: 9, color: "#ef4444", opacity: 0.7, marginTop: 2, fontWeight: 600, letterSpacing: 0.5 }}>אורחים</div>
            </div>
            <TeamLogo logo={awayLogo} name={awayTeam} size={44} />
          </div>
        </div>

        {/* ── PROBABILITY DISPLAY ── */}
        {/* direction:ltr set directly on each element — home=left, away=right */}
        <div>
          {/* Labels row */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
            marginBottom: 5, alignItems: "end",
            direction: "ltr",
          }}>
            <div style={{ textAlign: "left" }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: "#10b981" }}>{pct0(displayProbs.home)}</span>
              <span style={{ fontSize: 9, color: "#475569", marginLeft: 3 }}>1</span>
            </div>
            <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: 9, color: "#475569", marginRight: 3 }}>X</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#64748b" }}>{pct0(displayProbs.draw)}</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 9, color: "#475569", marginRight: 3 }}>2</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: "#ef4444" }}>{pct0(displayProbs.away)}</span>
            </div>
          </div>
          {/* Proportional stacked bar — flex-grow + explicit direction:ltr on the flex container */}
          <div style={{
            height: 6, borderRadius: 99, overflow: "hidden",
            display: "flex", direction: "ltr",
          }}>
            <div style={{ flexGrow: displayProbs.home, background: "#10b981" }} />
            <div style={{ width: 2, background: "#0F1318", flexShrink: 0 }} />
            <div style={{ flexGrow: displayProbs.draw, background: "#475569" }} />
            <div style={{ width: 2, background: "#0F1318", flexShrink: 0 }} />
            <div style={{ flexGrow: displayProbs.away, background: "#ef4444" }} />
          </div>
        </div>

        {/* ── DECIMAL ODDS STRIP ── */}
        {odds?.odds_home && (
          <OddsStrip odds={odds} valueBets={value_bets ?? undefined} />
        )}

        {/* ── OVER/UNDER 2.5 WINNING METHOD TABLE ── */}
        {goals_signal && (
          <OUWinningMethodRow gs={goals_signal} />
        )}

        {/* ── ASIAN HANDICAP — Safe Match shift (only when the trigger actually fires) ── */}
        {handicap_signal?.triggered && (
          <AsianHandicapRow hs={handicap_signal} />
        )}

        {/* ── CONSENSUS LOCK BANNER ── */}
        {consensusData?.is_consensus_lock && (
          <div style={{
            marginTop: 8,
            background: isWorldCup
              ? "linear-gradient(90deg, rgba(234,179,8,0.12), rgba(245,158,11,0.08), rgba(234,179,8,0.12))"
              : "rgba(245,158,11,0.08)",
            border: `1px solid ${isWorldCup ? "rgba(234,179,8,0.4)" : "rgba(245,158,11,0.22)"}`,
            borderRadius: 8,
            padding: isWorldCup ? "7px 12px" : "5px 12px",
            textAlign: "center",
          }}>
            <span style={{
              fontSize: isWorldCup ? 12 : 11,
              fontWeight: 800, color: "#f59e0b", letterSpacing: 0.4,
            }}>
              {isWorldCup
                ? `🔥 נעילת קונסנזוס מונדיאל (${prediction.confidence}% ביטחון אלגוריתם + הסכמת מומחים)`
                : `🔥 נעילת קונסנזוס (${consensusData.agreeing_count} אנליסטים)`}
            </span>
          </div>
        )}
      </div>

      {/* ── KEY FACTORS ── */}
      {prediction.key_factors.length > 0 && (
        <div className="key-factors" style={{ padding: "0 24px 12px", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {prediction.key_factors.map(f => {
            const info  = FACTOR_LABELS[f.factor] ?? { label: f.factor, icon: "•" };
            const color = f.impact === "CRITICAL" ? "rgba(239,68,68,0.12) border-red-500/20 text-red-400"
                        : f.impact === "HIGH"     ? "rgba(245,158,11,0.1) border-amber-500/20 text-amber-400"
                        : "rgba(100,116,139,0.1) border-slate-500/20 text-slate-400";
            return (
              <span key={f.factor}
                title={f.detail}
                style={{ background: color.split(" ")[0], border: `1px solid`, borderColor: color.split(" ")[1]?.replace("border-",""), borderRadius: 99, padding: "3px 8px", fontSize: 10, display: "flex", gap: 4, alignItems: "center" }}
                className={color.split(" ")[2]}
              >
                {info.icon} {info.label}
              </span>
            );
          })}
        </div>
      )}

      {/* ── COMPACT FOOTER: [למה? ▼]  [⚡ outcome +edge%]  [temp°C 🌡️] ── */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "8px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? "סגור ניתוח מפורט" : "פתח ניתוח מפורט"}
          style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 99, padding: "4px 12px", cursor: "pointer",
            color: "#64748b", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
            transition: "color 0.2s",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")}
          onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}
        >
          {expanded ? "למה? ▲" : "למה? ▼"}
        </button>

        {/* Inline value badge — direction:ltr prevents RTL flip of emoji/sign */}
        {anyValueBet && bestVB && (
          <div style={{
            display: "flex", alignItems: "center", gap: 5, direction: "ltr",
            background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)",
            borderRadius: 99, padding: "4px 10px",
          }}>
            <span style={{ fontSize: 12 }}>⚡</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#10b981" }}>
              {OUTCOME_HE[bestVB[0]] ?? bestVB[0]}
              {" "}({OUTCOME_12X[bestVB[0]] ?? "?"})
            </span>
            <span style={{ fontSize: 11, color: "rgba(16,185,129,0.8)" }}>
              +{bestVB[1]?.edge_percent?.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Goals signal badge */}
        {goals_signal?.signal && goals_signal.signal !== "NO_SIGNAL" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 5, direction: "ltr",
            background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)",
            borderRadius: 99, padding: "4px 10px",
          }}>
            <span style={{ fontSize: 12 }}>⚽</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa" }}>
              {goals_signal.signal === "OVER" ? `אובר ${goals_signal.line}` : `אנדר ${goals_signal.line}`}
            </span>
            <span style={{ fontSize: 11, color: "rgba(167,139,250,0.8)" }}>
              +{goals_signal.signal_edge.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Asian Handicap shift badge */}
        {handicap_signal?.triggered && (
          <div style={{
            display: "flex", alignItems: "center", gap: 5, direction: "ltr",
            background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)",
            borderRadius: 99, padding: "4px 10px",
          }}>
            <span style={{ fontSize: 12 }}>🎯</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#fb923c" }}>
              {handicap_signal.favorite_team} {handicap_signal.line}
            </span>
            {handicap_signal.ah_edge !== null && (
              <span style={{ fontSize: 11, color: "rgba(251,146,60,0.8)" }}>
                +{handicap_signal.ah_edge.toFixed(1)}%
              </span>
            )}
          </div>
        )}

        {/* Weather chip — right side */}
        {weather?.source === "live" && (
          <span style={{
            fontSize: 11, color: "#64748b", direction: "ltr",
            background: "rgba(255,255,255,0.04)", borderRadius: 99,
            padding: "4px 10px", whiteSpace: "nowrap",
          }}>
            {Math.round(weather.temperature_celsius)}°C 🌡️
          </span>
        )}
      </div>

      {/* ── EXPANDABLE BREAKDOWN ── */}
      <div>

        {expanded && (
          <div className="card-expanded" style={{ padding: "4px 24px 20px" }}>

            {/* ── WINNING METHOD TABLE ── */}
            {odds?.odds_home && (
              <WinningMethodTable
                probs={displayProbs}
                odds={odds}
                valueBets={value_bets}
                homeTeam={homeTeam}
                awayTeam={awayTeam}
                xg={xg ?? undefined}
              />
            )}

            {/* ── GOALS MARKET (Over/Under 2.5) — Phenomenal Winning Method Panel ── */}
            {(goals_signal || ou_edge) && (
              <PhenomenalWinningMethodPanel
                gs={goals_signal ?? null}
                ouEdge={ou_edge ?? null}
                homeTeam={homeTeam}
                awayTeam={awayTeam}
              />
            )}

            <ModuleChart modules={prediction.by_module} activeModules={prediction.active_modules} />

            {/* ── LINEUPS ── */}
            {lineups && (
              <LineupDisplay lineups={lineups} homeTeam={homeTeam} awayTeam={awayTeam} />
            )}

            {/* ── LIVE WEATHER ── */}
            {weather?.source === "live" && (
              <div style={{
                marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 8, padding: "6px 12px",
              }}>
                <span style={{ fontSize: 10, color: "#64748b" }}>🌡️ תנאי מזג אוויר במגרש (נתון חי)</span>
                <span style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600 }}>
                  {Math.round(weather.temperature_celsius)}°C · {weather.weather_condition}
                </span>
              </div>
            )}

            {/* ── TELEGRAM AUTO-SIGNAL NOTE ── */}
            {bestVB && (bestVB[1]?.rating === "STRONG" || bestVB[1]?.rating === "MODERATE") && (
              <div style={{
                marginTop: 10,
                background: "linear-gradient(90deg, rgba(56,189,248,0.08), rgba(99,102,241,0.06))",
                border: "1px solid rgba(56,189,248,0.2)",
                borderRadius: 8, padding: "7px 12px",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>
                  📨 הסיגנל נשלח אוטומטית לערוץ הטלגרם בעקבות זיהוי חריגת ערך
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 800, color: "#38bdf8",
                  background: "rgba(56,189,248,0.12)", borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap",
                }}>
                  HOT VALUE 🔥
                </span>
              </div>
            )}

            {/* ── ANALYST CONSENSUS SUMMARY ROW ── */}
            {consensusData ? (
              <div style={{
                marginTop: 12,
                background: consensusData.is_consensus_lock ? "rgba(245,158,11,0.05)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${consensusData.is_consensus_lock ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 8, padding: "8px 12px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>הניבוי שלנו</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "white" }}>
                    {PICK_HE[consensusData.our_pick] ?? consensusData.our_pick}{" "}
                    <span style={{ color: "#64748b", fontSize: 10, fontWeight: 600 }}>({consensusData.our_pick})</span>
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>הצלבת אנליסטים מהעולם</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: consensusData.is_consensus_lock ? "#f59e0b" : "#94a3b8" }}>
                    {consensusData.consensus_rate}% הסכמה
                  </div>
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>תומכים</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "white" }}>{consensusData.agreeing_count}</div>
                </div>
              </div>
            ) : consensusLoading ? (
              <div role="status" aria-live="polite" style={{ marginTop: 12, textAlign: "center", color: "#f59e0baa", fontSize: 10, fontWeight: 700 }}>
                ⏳ בודק קונסנזוס אנליסטים...
              </div>
            ) : null}

            {/* Consensus row */}
            {consensus?.analysts && (
              <div style={{
                marginTop: 12,
                padding: "10px 14px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 10,
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                gap: 8, alignItems: "center",
                direction: "ltr",
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", textAlign: "left" }}>
                  {pct0(consensus.analysts.home)}
                </span>
                <span style={{ fontSize: 10, color: "#64748b", textAlign: "center" }}>👥 מומחים</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", textAlign: "right" }}>
                  {pct0(consensus.analysts.away)}
                </span>
              </div>
            )}

            {/* Monte Carlo stats — first column shows the LEADING team, not always home */}
            <div className="monte-carlo-row" style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.05)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center", direction: "ltr" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: mcLeaderColor }}>
                  📈 {pct0(mcLeaderPct)}
                </div>
                <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>{mcLeaderLabel}</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: prediction.confidence > 75 ? "#10b981" : prediction.confidence > 55 ? "#f59e0b" : "#ef4444" }}>
                  🎯 {prediction.confidence}%
                </div>
                <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>רמת ביטחון</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>🎲 {prediction.monte_carlo.simulations.toLocaleString("he-IL")}</div>
                <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>סימולציות</div>
              </div>
            </div>

            {/* ── CROSS-CHECK ── */}
            {!crossCheck ? (
              <button
                onClick={runCrossCheck}
                disabled={crossCheckLoading}
                aria-label={crossCheckLoading ? "מצלב נתוני שטח, אנא המתן" : "הצלב ניבוי עם נתוני שטח"}
                style={{
                  marginTop: 14,
                  width: "100%",
                  padding: "9px 0",
                  background: crossCheckLoading ? "rgba(99,102,241,0.05)" : "rgba(99,102,241,0.08)",
                  border: "1px solid rgba(99,102,241,0.25)",
                  borderRadius: 10,
                  color: crossCheckLoading ? "#6366f1aa" : "#818cf8",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: crossCheckLoading ? "wait" : "pointer",
                  transition: "all 0.2s",
                  letterSpacing: 0.3,
                }}
              >
                {crossCheckLoading ? "⏳ מצלב נתוני שטח..." : "🔬 הצלב עם נתוני שטח"}
              </button>
            ) : (
              <div style={{
                marginTop: 14,
                background: crossCheck.consensus_reached
                  ? "rgba(16,185,129,0.06)"
                  : "rgba(239,68,68,0.06)",
                border: `1px solid ${crossCheck.consensus_reached ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.18)"}`,
                borderRadius: 12,
                padding: "12px 14px",
              }}>
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>🔬 הצלבה עם נתוני שטח</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: crossCheck.consensus_reached ? "#10b981" : "#f59e0b",
                  }}>
                    {crossCheck.consensus_reached ? "✓ קונסנזוס" : "⚠ פיצול"}
                  </span>
                </div>

                {/* Confidence comparison */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "#64748b" }}>{crossCheck.original_confidence}%</div>
                    <div style={{ fontSize: 9, color: "#475569" }}>מקורי</div>
                  </div>
                  <div style={{ fontSize: 18, color: crossCheck.alignment_score >= 0 ? "#10b981" : "#ef4444" }}>
                    {crossCheck.alignment_score >= 0 ? "↗" : "↘"}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{
                      fontSize: 20, fontWeight: 900,
                      color: crossCheck.adjusted_confidence > 75 ? "#10b981"
                           : crossCheck.adjusted_confidence > 55 ? "#f59e0b"
                           : "#ef4444",
                    }}>{crossCheck.adjusted_confidence}%</div>
                    <div style={{ fontSize: 9, color: "#475569" }}>מעודכן</div>
                  </div>
                  <div style={{
                    marginRight: "auto",
                    fontSize: 11, fontWeight: 700,
                    color: crossCheck.alignment_score >= 0 ? "#10b981" : "#ef4444",
                    background: crossCheck.alignment_score >= 0 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                    border: `1px solid ${crossCheck.alignment_score >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                    borderRadius: 99,
                    padding: "2px 9px",
                  }}>
                    {crossCheck.alignment_score >= 0 ? "+" : ""}{crossCheck.alignment_score}%
                  </div>
                </div>

                {/* Insights */}
                <div style={{
                  fontSize: 11, color: "#94a3b8", lineHeight: 1.6,
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                  paddingTop: 8,
                }}>
                  {crossCheck.expert_summary_hebrew}
                </div>

                {/* Source + reset */}
                <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 9, color: "#334155" }}>
                    מקור:{" "}
                    {crossCheck.data_source === "api-football" ? "⚡ API-Football"
                   : crossCheck.data_source === "text-analysis" ? "📝 ניתוח טקסט"
                   : "🔮 סימולציה"}
                  </span>
                  <button
                    onClick={() => setCrossCheck(null)}
                    aria-label="נקה תוצאות הצלבה"
                    style={{ fontSize: 9, color: "#334155", background: "none", border: "none", cursor: "pointer" }}
                  >
                    × נקה
                  </button>
                </div>
              </div>
            )}
            {/* ── ANALYST CONSENSUS PANEL ── */}
            <div style={{ marginTop: 10 }}>
              {!consensusData ? (
                <button
                  onClick={runConsensusCheck}
                  disabled={consensusLoading}
                  aria-label={consensusLoading ? "בודק קונסנזוס אנליסטים, אנא המתן" : "הצלב ניבוי עם אנליסטים חיצוניים"}
                  style={{
                    width: "100%",
                    padding: "9px 0",
                    background: consensusLoading ? "rgba(245,158,11,0.04)" : "rgba(245,158,11,0.07)",
                    border: "1px solid rgba(245,158,11,0.22)",
                    borderRadius: 10,
                    color: consensusLoading ? "#f59e0baa" : "#fbbf24",
                    fontSize: 12, fontWeight: 700,
                    cursor: consensusLoading ? "wait" : "pointer",
                    transition: "all 0.2s",
                    letterSpacing: 0.3,
                  }}
                >
                  {consensusLoading ? "⏳ בודק קונסנזוס אנליסטים..." : "👥 הצלב עם אנליסטים חיצוניים"}
                </button>
              ) : (
                <div style={{
                  background: consensusData.is_consensus_lock
                    ? "rgba(245,158,11,0.07)"
                    : "rgba(100,116,139,0.06)",
                  border: `1px solid ${consensusData.is_consensus_lock ? "rgba(245,158,11,0.25)" : "rgba(100,116,139,0.15)"}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                }}>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: consensusData.expert_advice ? 4 : 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>👥 קונסנזוס אנליסטים</span>
                    <span style={{
                      fontSize: 11, fontWeight: 800,
                      color: consensusData.is_consensus_lock ? "#f59e0b" : "#94a3b8",
                    }}>
                      {consensusData.display_badge}
                    </span>
                  </div>
                  {consensusData.expert_advice ? (
                    <div style={{ fontSize: 10, color: "#64748b", fontStyle: "italic", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      💬 {consensusData.expert_advice}
                    </div>
                  ) : null}

                  {/* Stats row */}
                  <div className="consensus-stats-row" style={{ display: "flex", gap: 16, marginBottom: 10 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: consensusData.is_consensus_lock ? "#f59e0b" : "#94a3b8" }}>
                        {consensusData.consensus_rate}%
                      </div>
                      <div style={{ fontSize: 9, color: "#475569" }}>הסכמה</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "white" }}>
                        {consensusData.agreeing_count}
                      </div>
                      <div style={{ fontSize: 9, color: "#475569" }}>תומכים/סה״כ</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#10b981" }}>
                        {consensusData.avg_analysts_confidence}%
                      </div>
                      <div style={{ fontSize: 9, color: "#475569" }}>ביטחון ממוצע</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#818cf8" }}>
                        {consensusData.our_pick}
                      </div>
                      <div style={{ fontSize: 9, color: "#475569" }}>בחירת המערכת</div>
                    </div>
                  </div>

                  {/* Individual picks */}
                  <div style={{
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                    paddingTop: 8,
                    display: "flex", flexDirection: "column", gap: 5,
                  }}>
                    {consensusData.analysts.map((a, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#64748b" }}>{a.name}</span>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 9, color: "#475569" }}>{a.confidence}%</span>
                          <span style={{
                            fontSize: 11, fontWeight: 900,
                            color: a.pick === consensusData.our_pick ? "#10b981" : "#ef4444",
                            background: a.pick === consensusData.our_pick ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.08)",
                            border: `1px solid ${a.pick === consensusData.our_pick ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.2)"}`,
                            borderRadius: 6,
                            padding: "1px 7px",
                            minWidth: 22, textAlign: "center",
                          }}>
                            {a.pick}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Footer */}
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: "#334155" }}>
                      {consensusData.data_source === "api-football"
                        ? "🌐 API-Football"
                        : consensusData.is_demo
                          ? "🔮 דמו — אנליסטים לדוגמה"
                          : "👥 אנליסטים מה-DB"}
                    </span>
                    <button
                      onClick={() => setConsensusData(null)}
                      aria-label="נקה נתוני קונסנזוס"
                      style={{ fontSize: 9, color: "#334155", background: "none", border: "none", cursor: "pointer" }}
                    >
                      × נקה
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
