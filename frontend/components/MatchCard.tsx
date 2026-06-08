"use client";

import { useState, useEffect, useRef } from "react";

interface Prediction {
  final: { home: number; draw: number; away: number };
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

interface MatchCardProps {
  homeTeam:    string;
  awayTeam:    string;
  homeLogo?:   string;
  awayLogo?:   string;
  league?:     string;
  leagueLogo?: string;
  matchDate?:  string;
  isLive?:     boolean;
  prediction:  Prediction;
  value_bets?: ValueBets;
  consensus?:  Consensus;
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
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
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
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ fontSize: 14, fontWeight: 900, color }}>{value}%</div>
        <div style={{ fontSize: 8, color: "#64748b", marginTop: -2 }}>ביטחון</div>
      </div>
    </div>
  );
}

// ===== Module breakdown mini-chart =====
function ModuleChart({ modules }: { modules: Prediction["by_module"] }) {
  const rows = [
    { key: "stats",       label: "סטטיסטיקה",   icon: "📊", home: modules.stats.home,       away: modules.stats.away },
    { key: "environment", label: "סביבה",        icon: "🌡", home: modules.environment.home,  away: modules.environment.away },
    { key: "human",       label: "פציעות/שופט",  icon: "🩹", home: modules.human.home,        away: modules.human.away },
    { key: "psychology",  label: "פסיכולוגיה",   icon: "🧠", home: modules.psychology.home,   away: modules.psychology.away },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map(row => (
        <div key={row.key} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
          {/* Away (right in RTL → left in LTR grid) */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "white", fontWeight: 600 }}>{pct0(row.home)}</span>
            <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${row.home * 100}%`, background: "#10b981", borderRadius: 99, transition: "width 0.8s ease" }} />
            </div>
          </div>
          {/* Label */}
          <div style={{ textAlign: "center", minWidth: 110 }}>
            <span style={{ fontSize: 10 }}>{row.icon}</span>
            <span style={{ fontSize: 10, color: "#64748b", marginRight: 4 }}>{row.label}</span>
          </div>
          {/* Home */}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${row.away * 100}%`, background: "#ef4444", borderRadius: 99, transition: "width 0.8s ease" }} />
            </div>
            <span style={{ fontSize: 12, color: "white", fontWeight: 600 }}>{pct0(row.away)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MatchCard({
  homeTeam, awayTeam, homeLogo, awayLogo, league, leagueLogo,
  matchDate, isLive = false,
  prediction, value_bets, consensus,
}: MatchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const displayProbs = consensus?.master ?? prediction.final;
  const anyValueBet  = Object.values(value_bets ?? {}).some(v => v?.is_value_bet);
  const bestVB       = Object.entries(value_bets ?? {}).find(([, v]) => v?.is_value_bet);
  const cfg          = CONSENSUS_CONFIG[consensus?.type ?? "ALGORITHM_ONLY"] ?? CONSENSUS_CONFIG.ALGORITHM_ONLY;

  const homeWin = displayProbs.home > displayProbs.away && displayProbs.home > displayProbs.draw;
  const awayWin = displayProbs.away > displayProbs.home && displayProbs.away > displayProbs.draw;

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl border overflow-hidden transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl ${cfg.border}`}
      style={{ background: "#0F1318", boxShadow: anyValueBet ? "0 0 30px rgba(16,185,129,0.08)" : undefined }}
    >
      {/* ── LIVE INDICATOR ── */}
      {isLive && (
        <div style={{ background: "rgba(239,68,68,0.12)", borderBottom: "1px solid rgba(239,68,68,0.2)", padding: "6px 20px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 1.5s infinite", boxShadow: "0 0 6px #ef4444" }} />
          <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>LIVE</span>
        </div>
      )}

      {/* ── HEADER ── */}
      <div style={{ padding: "16px 20px 14px" }}>

        {/* League + badge row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
            {cfg.label}
          </span>
          {league && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {leagueLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={leagueLogo} alt={league} width={12} height={12}
                  style={{ objectFit: "contain", opacity: 0.6 }} />
              )}
              <span style={{ fontSize: 10, color: "#374151" }}>{league}</span>
            </div>
          )}
          {matchDate && (
            <span style={{ fontSize: 10, color: "#334155", direction: "ltr" }}>
              {matchDate.split(" ")[0]} {matchDate.split(" ")[1]}
            </span>
          )}
        </div>

        {/* ── SCOREBOARD ROW: Home | Center | Away ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
        }}>

          {/* HOME — שמאל */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <TeamLogo logo={homeLogo} name={homeTeam} size={48} />
            <div>
              <div style={{
                fontSize: 13, fontWeight: 800, lineHeight: 1.2,
                color: homeWin ? "#10b981" : "white",
                maxWidth: 110,
              }}>
                {homeTeam}
              </div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 3, fontWeight: 600, letterSpacing: 0.5 }}>
                בית
              </div>
            </div>
          </div>

          {/* CENTER — אחוזים + ביטחון */}
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            {/* 3 probability pills */}
            <div style={{ display: "flex", gap: 4 }}>
              {([
                { key: "home", val: displayProbs.home, color: "#10b981", bg: "rgba(16,185,129,0.12)" },
                { key: "draw", val: displayProbs.draw, color: "#94a3b8", bg: "rgba(148,163,184,0.08)" },
                { key: "away", val: displayProbs.away, color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
              ] as const).map(p => (
                <div key={p.key} style={{
                  background: p.bg,
                  border: `1px solid ${p.color}30`,
                  borderRadius: 8,
                  padding: "5px 8px",
                  textAlign: "center",
                  minWidth: 44,
                }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: p.color, lineHeight: 1 }}>
                    {pct0(p.val)}
                  </div>
                  <div style={{ fontSize: 8, color: "#475569", marginTop: 2 }}>
                    {p.key === "home" ? "בית" : p.key === "draw" ? "תיקו" : "אורחים"}
                  </div>
                </div>
              ))}
            </div>

            {/* Confidence */}
            <div style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "rgba(255,255,255,0.04)", borderRadius: 99,
              padding: "3px 10px",
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: prediction.confidence > 75 ? "#10b981" : prediction.confidence > 55 ? "#f59e0b" : "#ef4444",
                boxShadow: `0 0 4px ${prediction.confidence > 75 ? "#10b981" : prediction.confidence > 55 ? "#f59e0b" : "#ef4444"}`,
              }} />
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: prediction.confidence > 75 ? "#10b981" : prediction.confidence > 55 ? "#f59e0b" : "#ef4444",
              }}>
                {prediction.confidence}%
              </span>
              <span style={{ fontSize: 9, color: "#475569" }}>ביטחון</span>
            </div>
          </div>

          {/* AWAY — ימין */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
            <div style={{ textAlign: "left" }}>
              <div style={{
                fontSize: 13, fontWeight: 800, lineHeight: 1.2,
                color: awayWin ? "#ef4444" : "white",
                maxWidth: 110,
              }}>
                {awayTeam}
              </div>
              <div style={{ fontSize: 9, color: "#475569", marginTop: 3, fontWeight: 600, letterSpacing: 0.5 }}>
                אורחים
              </div>
            </div>
            <TeamLogo logo={awayLogo} name={awayTeam} size={48} />
          </div>
        </div>

        {/* ── PROB BAR ── */}
        <div style={{ height: 6, borderRadius: 99, overflow: "hidden", display: "flex", gap: 1.5, background: "rgba(255,255,255,0.04)" }}>
          <AnimatedBar value={displayProbs.home} color="bg-emerald-500" delay={0} />
          <AnimatedBar value={displayProbs.draw} color="bg-slate-600"   delay={100} />
          <AnimatedBar value={displayProbs.away} color="bg-rose-500"    delay={200} />
        </div>
      </div>

      {/* ── KEY FACTORS ── */}
      {prediction.key_factors.length > 0 && (
        <div style={{ padding: "0 24px 12px", display: "flex", flexWrap: "wrap", gap: 6 }}>
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

      {/* ── VALUE BET ── */}
      {anyValueBet && bestVB && (
        <div style={{
          margin: "0 24px 16px",
          background: "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.06))",
          border: "1px solid rgba(16,185,129,0.3)",
          borderRadius: 14,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <div style={{ color: "#10b981", fontWeight: 900, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
              <span>⚡</span> זוהה הימור ערך
            </div>
            <div style={{ color: "rgba(16,185,129,0.7)", fontSize: 11, marginTop: 3 }}>
              {OUTCOME_HE[bestVB[0]] ?? bestVB[0]} — יתרון{" "}
              <span style={{ fontWeight: 700 }}>+{bestVB[1]?.edge_percent?.toFixed(1)}%</span> מהשוק
            </div>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ color: "#10b981", fontSize: 28, fontWeight: 900, lineHeight: 1 }}>
              {bestVB[1]?.bookmaker_odds}x
            </div>
            <div style={{ fontSize: 9, color: "rgba(16,185,129,0.5)", marginTop: 2 }}>
              {bestVB[1]?.rating === "STRONG" ? "⭐⭐⭐" : bestVB[1]?.rating === "MODERATE" ? "⭐⭐" : "⭐"}
            </div>
          </div>
        </div>
      )}

      {/* ── EXPANDABLE BREAKDOWN ── */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: "100%", padding: "12px 24px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "none", border: "none", cursor: "pointer",
            color: "#64748b", fontSize: 11,
            transition: "color 0.2s",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")}
          onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}
        >
          <span style={{ fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
          <span>שיטת הניצחון — פירוט מלא</span>
        </button>

        {expanded && (
          <div style={{ padding: "4px 24px 20px" }}>
            <ModuleChart modules={prediction.by_module} />

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
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", textAlign: "right" }}>
                  {pct0(consensus.analysts.home)}
                </span>
                <span style={{ fontSize: 10, color: "#64748b", textAlign: "center" }}>👥 מומחים</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#ef4444" }}>
                  {pct0(consensus.analysts.away)}
                </span>
              </div>
            )}

            {/* Monte Carlo stats */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.05)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>🎲 {prediction.monte_carlo.simulations.toLocaleString("he-IL")}</div>
                <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>סימולציות</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: prediction.confidence > 75 ? "#10b981" : prediction.confidence > 55 ? "#f59e0b" : "#ef4444" }}>
                  🎯 {prediction.confidence}%
                </div>
                <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>רמת ביטחון</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>
                  📈 {pct0(prediction.monte_carlo.home)}
                </div>
                <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>MC בית</div>
              </div>
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
