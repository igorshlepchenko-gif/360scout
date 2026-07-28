"use client";

import { useState } from "react";

export interface TickerItem { text: string }

export interface TickerMatch {
  home_team:   string;
  away_team:   string;
  league?:     string;
  value_bets?: Record<string, { is_value_bet: boolean; edge_percent: number; bookmaker_odds?: number }> | null;
  odds?:       { odds_home?: number; odds_draw?: number; odds_away?: number } | null;
  prediction?: { final: { home: number; draw: number; away: number }; confidence: number };
}

const OUTCOME_HE: Record<string, string> = { home: "בית", draw: "תיקו", away: "אורחים" };

function buildTickerItems(matches: TickerMatch[]): TickerItem[] {
  const items: TickerItem[] = [];

  const valueBetMatches = matches.filter(m => m.value_bets &&
    Object.values(m.value_bets).some(v => v?.is_value_bet));
  for (const m of valueBetMatches) {
    const entry = Object.entries(m.value_bets ?? {}).find(([, v]) => v?.is_value_bet);
    if (!entry) continue;
    const [outcome, vb] = entry;
    const oddsStr = vb.bookmaker_odds ? ` @ ${vb.bookmaker_odds.toFixed(2)}` : "";
    items.push({
      text: `⚡ Value Bet | ${m.home_team} vs ${m.away_team} → ${OUTCOME_HE[outcome]}${oddsStr} · Edge +${vb.edge_percent.toFixed(1)}%`,
    });
  }

  if (items.length === 0) {
    return [
      { text: "⚡ Value Bet שזוהה? קבלו התראה מיידית בערוץ הטלגרם שלנו!" },
      { text: "🔬 ניתוח 360°: xG · מזג אוויר · שופט · פציעות · פסיכולוגיה · קונסנזוס" },
    ];
  }
  return items;
}

export default function LiveTicker({
  items,
  matches,
}: {
  items?:   TickerItem[];
  matches?: TickerMatch[];
}) {
  const [paused, setPaused] = useState(false);

  const resolvedItems = items ?? (matches ? buildTickerItems(matches) : [
    { text: "⚡ Value Bet שזוהה? קבלו התראה מיידית בערוץ הטלגרם שלנו!" },
    { text: "🔬 ניתוח 360°: xG · מזג אוויר · שופט · פציעות · פסיכולוגיה · קונסנזוס" },
  ]);
  if (!resolvedItems.length) return null;

  const allItems = [...resolvedItems, ...resolvedItems];

  return (
    <div
      role="region"
      aria-label="מבזקי לייב ועסקאות ערך"
      style={{
        display: "flex",
        background: "linear-gradient(90deg, #1e293b, #0f172a)",
        color: "#ffffff",
        direction: "rtl",
        height: 40,
        alignItems: "center",
        borderBottom: "2px solid var(--scan-500)",
        overflow: "hidden",
        position: "fixed",
        top: 0, left: 0,
        width: "100%",
        zIndex: 9999,
      }}
    >
      {/* Fixed label */}
      <div
        aria-hidden="true"
        style={{
          background: "#e11d48",
          color: "white",
          padding: "0 15px",
          height: "100%",
          display: "flex",
          alignItems: "center",
          fontWeight: "bold",
          fontSize: "0.875rem",
          whiteSpace: "nowrap",
          boxShadow: "5px 0 15px rgba(0,0,0,0.3)",
          zIndex: 2,
          flexShrink: 0,
        }}
      >
        🔥 המלצות לייב:
      </div>

      {/* Pause / play button — keyboard accessible */}
      <button
        onClick={() => setPaused(p => !p)}
        aria-label={paused ? "המשך גלילת המבזקים" : "עצור גלילת המבזקים"}
        style={{
          background: "none",
          border: "1px solid rgba(255,255,255,0.25)",
          color: "rgba(255,255,255,0.7)",
          padding: "0 8px",
          height: "65%",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 11,
          flexShrink: 0,
          marginRight: 8,
          lineHeight: 1,
        }}
      >
        {paused ? "▶" : "⏸"}
      </button>

      {/* Scrolling area */}
      <div
        className="ticker-wrap"
        style={{
          flexGrow: 1,
          overflow: "hidden",
          height: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          className="ticker-items"
          style={{
            display: "flex",
            whiteSpace: "nowrap",
            paddingRight: "100%",
            animationPlayState: paused ? "paused" : "running",
          }}
        >
          {allItems.map((item, i) => (
            <span
              key={i}
              style={{
                padding: "0 40px",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#f1f5f9",
              }}
            >
              {item.text}
            </span>
          ))}
        </div>
      </div>

      {/* Screen-reader live region — announces first item once */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {resolvedItems[0]?.text}
      </div>
    </div>
  );
}
