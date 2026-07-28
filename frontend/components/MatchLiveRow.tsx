"use client";
import { useEffect, useRef, useState } from "react";
import { Clock, TrendingUp, Zap, RefreshCcw } from "lucide-react";
import { calculateValueBets, marketOddsFromValueBets, type OutcomeEdge } from "@/utils/analytics";
import { bestValueBet } from "@/lib/valueBets";
import { useLiveClock } from "@/hooks/useLiveClock";
import { describeRecommendation, type RecommendationData } from "@/lib/recommendation";

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
    recommendation?: RecommendationData | null;
  };
  value_bets?: Record<
    string,
    { is_value_bet: boolean; edge_percent: number; rating: string; bookmaker_odds: number; xg_estimated?: boolean }
  > | null;
  data_quality?: {
    xg_source: string;
    xg_method: string;
    xg_estimated: boolean;
    form_source: string;
    h2h_used: boolean;
  } | null;
}

function DataQualityBadge({ dq }: { dq: NonNullable<LiveMatch["data_quality"]> }) {
  const isReal    = !dq.xg_estimated;
  const isTotals  = dq.xg_method === "totals";
  const label     = isReal ? "xG · Real" : isTotals ? "xG · Totals" : "xG · Est";
  const color     = isReal ? "#3b82f6" : isTotals ? "#f59e0b" : "#64748b";
  const bg        = isReal ? "rgba(59,130,246,0.08)" : isTotals ? "rgba(245,158,11,0.08)" : "rgba(100,116,139,0.08)";
  const border    = isReal ? "rgba(59,130,246,0.2)"  : isTotals ? "rgba(245,158,11,0.2)"  : "rgba(100,116,139,0.15)";
  return (
    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: bg, color, border: `1px solid ${border}`, fontFamily: "var(--font-mono), monospace", letterSpacing: "0.03em" }}>
      {label}
    </span>
  );
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
      <div style={{ color: "white", fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono), monospace" }}>
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
          fontFamily: "var(--font-mono), monospace",
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

  const scoreTxt =
    m.score && m.score.home !== null
      ? `${m.score.home} - ${m.score.away}`
      : "0 - 0";

  // useLiveClock: ticks every real minute independently of API polling.
  // Snaps to server elapsed when a new value arrives (goal / card / HT event).
  const timeTxt = useLiveClock(m.elapsed, m.status_short) || "LIVE";

  // ── The single recommendation — same source of truth as the dashboard cards ──
  const rec = describeRecommendation(m.prediction?.recommendation, m.home_team, m.away_team);

  // ── Change tracking: this view polls every 20s during play, so the pick can
  // genuinely shift mid-match. Instead of silently swapping the text, remember
  // what it changed FROM and when, so a shift reads as "informed update" rather
  // than an unexplained flip. First render never counts as a "change".
  const prevKeyRef   = useRef<string | null>(null);
  const prevLabelRef = useRef<string | null>(null);
  const [lastChange, setLastChange] = useState<{ from: string; at: string } | null>(null);

  useEffect(() => {
    if (rec.key === "none") return;
    if (prevKeyRef.current !== null && prevKeyRef.current !== rec.key) {
      setLastChange({ from: prevLabelRef.current ?? "המלצה קודמת", at: timeTxt });
    }
    prevKeyRef.current   = rec.key;
    prevLabelRef.current = rec.label;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.key]);

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
              fontFamily: "var(--font-mono), monospace",
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {m.league && (
            <span style={{ color: "#475569", fontSize: 11 }}>{m.league}</span>
          )}
          {m.data_quality && <DataQualityBadge dq={m.data_quality} />}
        </div>
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── Row 1: THE recommendation + confidence ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#475569", fontSize: 10, marginBottom: 3 }}>🎯 ההמלצה שלנו</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: rec.tone === "pick" ? "#10b981" : rec.tone === "caution" ? "#f59e0b" : "white",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <Zap size={13} style={{ color: "#f59e0b", fill: "#f59e0b" }} />
              {rec.label}
              {rec.detail && (
                <span style={{ color: "#475569", fontWeight: 400, fontSize: 11, fontFamily: "monospace" }}>
                  ({rec.detail})
                </span>
              )}
            </div>
            {lastChange && (
              <div style={{
                display: "flex", alignItems: "center", gap: 4, marginTop: 4,
                color: "#f59e0b", fontSize: 10,
              }}>
                <RefreshCcw size={10} />
                <span>עודכן בדקה {lastChange.at} — היה: {lastChange.from}</span>
              </div>
            )}
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
                  fontFamily: "var(--font-mono), monospace",
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
