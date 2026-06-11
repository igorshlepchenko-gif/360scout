"use client";
import { Clock, TrendingUp, Zap } from "lucide-react";
import { calculateValueBets, marketOddsFromValueBets, type OutcomeEdge } from "@/utils/analytics";
import { bestValueBet } from "@/lib/valueBets";

export interface LiveMatch {
  fixture_id: number;
  home_team: string;
  away_team: string;
  league?: string;
  _status?: string;
  elapsed?: number | null;
  status_short?: string | null;
  score?: { home: number | null; away: number | null } | null;
  prediction?: {
    final: { home: number; draw: number; away: number };
    confidence: number;
  };
  value_bets?: Record<
    string,
    { is_value_bet: boolean; edge_percent: number; rating: string; bookmaker_odds: number }
  > | null;
}

function EdgePill({ o }: { o: OutcomeEdge }) {
  const color = o.isValue
    ? { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.35)", text: "#10b981" }
    : o.edgePct >= 0
    ? { bg: "rgba(100,116,139,0.1)", border: "rgba(100,116,139,0.2)", text: "#64748b" }
    : { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", text: "#ef4444" };

  return (
    <div
      style={{
        flex: 1,
        border: `1px solid ${color.border}`,
        borderRadius: 10,
        background: color.bg,
        padding: "8px 6px",
        textAlign: "center",
      }}
    >
      <div style={{ color: "#64748b", fontSize: 10, marginBottom: 3 }}>
        {o.label12X} ({o.labelHe})
      </div>
      <div style={{ color: "white", fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>
        {o.marketOdds.toFixed(2)}
      </div>
      <div style={{ color: "#475569", fontSize: 10, margin: "2px 0" }}>
        מודל: {o.fairOdds}
      </div>
      <div
        style={{
          color: color.text,
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "monospace",
        }}
      >
        {o.edgePct >= 0 ? `+${o.edgePct}%` : `${o.edgePct}%`}
        {o.isValue && " ⚡"}
      </div>
    </div>
  );
}

export default function MatchLiveRow({ match: m }: { match: LiveMatch }) {
  const final = m.prediction?.final;
  const algoProbs = final
    ? { home: final.home, draw: final.draw, away: final.away }
    : null;

  const marketOdds = marketOddsFromValueBets(m.value_bets);
  const analysis = algoProbs ? calculateValueBets(algoProbs, marketOdds) : null;

  // authoritative best value bet from backend flag
  const authoritative = bestValueBet(m.value_bets);

  const topKey = final
    ? (Object.entries(final).sort((a, b) => b[1] - a[1])[0][0] as "home" | "draw" | "away")
    : null;
  const topPct = topKey && final ? Math.round(final[topKey] * 100) : null;

  const scoreTxt =
    m.score && m.score.home !== null
      ? `${m.score.home} - ${m.score.away}`
      : "0 - 0";
  const timeTxt =
    m.status_short === "HT" ? "מחצית" : m.elapsed ? `${m.elapsed}'` : "LIVE";

  const OUTCOME_HE: Record<string, string> = {
    home: "ניצחון בית (1)",
    draw: "תיקו (X)",
    away: "ניצחון חוץ (2)",
  };

  return (
    <div
      style={{
        background: "#0F1318",
        border: authoritative
          ? "1px solid rgba(16,185,129,0.35)"
          : "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        overflow: "hidden",
        transition: "border-color 0.2s",
      }}
    >
      {/* ── Header: time | score | teams ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(0,0,0,0.25)",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "rgba(239,68,68,0.12)",
              color: "#ef4444",
              fontWeight: 700,
              fontFamily: "monospace",
              fontSize: 11,
              padding: "3px 7px",
              borderRadius: 6,
            }}
          >
            <Clock size={11} />
            {timeTxt}
          </span>
          <span
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "#cbd5e1",
              fontWeight: 700,
              fontFamily: "monospace",
              fontSize: 13,
              padding: "3px 10px",
              borderRadius: 6,
              direction: "ltr",
            }}
          >
            {scoreTxt}
          </span>
          <span style={{ color: "white", fontWeight: 600, fontSize: 14, direction: "ltr" }}>
            {m.home_team} vs {m.away_team}
          </span>
        </div>
        {m.league && (
          <span style={{ color: "#475569", fontSize: 11 }}>{m.league}</span>
        )}
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── Row 1: model selection + confidence ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#475569", fontSize: 10, marginBottom: 3 }}>בחירת המודל</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "white",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <Zap size={13} style={{ color: "#f59e0b", fill: "#f59e0b" }} />
              {topKey ? OUTCOME_HE[topKey] : "—"}
              {topPct !== null && (
                <span style={{ color: "#475569", fontWeight: 400, fontSize: 11, fontFamily: "monospace" }}>
                  ({topPct}%)
                </span>
              )}
            </div>
          </div>

          {m.prediction?.confidence !== undefined && (
            <div style={{ marginRight: "auto" }}>
              <div style={{ color: "#475569", fontSize: 10, marginBottom: 3 }}>ביטחון</div>
              <div
                style={{
                  color:
                    m.prediction.confidence >= 70
                      ? "#10b981"
                      : m.prediction.confidence >= 50
                      ? "#f59e0b"
                      : "#94a3b8",
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: "monospace",
                }}
              >
                {Math.round(m.prediction.confidence)}%
              </div>
            </div>
          )}
        </div>

        {/* ── Row 2: odds breakdown grid 1 | X | 2 ── */}
        {analysis && analysis.breakdown.length > 0 ? (
          <div style={{ display: "flex", gap: 8 }}>
            {analysis.breakdown.map(o => (
              <EdgePill key={o.key} o={o} />
            ))}
          </div>
        ) : (
          <div
            style={{
              color: "#374151",
              fontSize: 12,
              textAlign: "center",
              padding: "10px 0",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 8,
            }}
          >
            אין יחסי שוק זמינים למשחק זה
          </div>
        )}

        {/* ── Row 3: value alert + CTA ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {authoritative ? (
            <div
              style={{
                flex: 1,
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.3)",
                borderRadius: 8,
                padding: "8px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              <span style={{ fontSize: 16 }}>🚨</span>
              <div>
                <div style={{ color: "#10b981", fontWeight: 700, fontSize: 12 }}>
                  זוהה הימור ערך — סימון {authoritative[0] === "home" ? "1" : authoritative[0] === "draw" ? "X" : "2"} ביחס {authoritative[1].bookmaker_odds?.toFixed(2)}
                </div>
                <div style={{ color: "#064e3b", fontSize: 11, marginTop: 2 }}>
                  Edge: +{authoritative[1].edge_percent.toFixed(1)}% · דירוג: {authoritative[1].rating}
                </div>
              </div>
            </div>
          ) : analysis?.hasValue ? (
            <div
              style={{
                flex: 1,
                background: "rgba(245,158,11,0.07)",
                border: "1px solid rgba(245,158,11,0.25)",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 12,
                color: "#f59e0b",
              }}
            >
              ⚡ חישוב צד-לקוח מזהה ערך — ממתין לאישור backend
            </div>
          ) : null}

          <a
            href="https://t.me/Malmilyan"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "#ef4444",
              color: "black",
              fontWeight: 700,
              fontSize: 12,
              padding: "8px 16px",
              borderRadius: 8,
              textDecoration: "none",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <TrendingUp size={13} />
            התראות לייב
          </a>
        </div>
      </div>
    </div>
  );
}
