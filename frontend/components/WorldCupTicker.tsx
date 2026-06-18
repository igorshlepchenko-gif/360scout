"use client";

export interface TickerItem {
  text: string;
}

export interface TickerMatch {
  home_team:   string;
  away_team:   string;
  league?:     string;
  value_bets?: Record<string, { is_value_bet: boolean; edge_percent: number; bookmaker_odds?: number }> | null;
  odds?:       { odds_home?: number; odds_draw?: number; odds_away?: number } | null;
  prediction?: { final: { home: number; draw: number; away: number }; confidence: number };
}

const OUTCOME_HE: Record<string, string> = { home: "בית", draw: "תיקו", away: "אורחים" };
const IS_WC = (m: TickerMatch) => /world.?cup|fifa|מונדיאל/i.test(m.league ?? "");

function buildTickerItems(matches: TickerMatch[]): TickerItem[] {
  const items: TickerItem[] = [];

  // ── 1. World Cup picks (always first) ─────────────────────────────────────
  const wcMatches = matches.filter(IS_WC);
  for (const m of wcMatches) {
    const final    = m.prediction?.final;
    const conf     = m.prediction?.confidence ?? 0;
    if (!final) continue;
    const top      = Object.entries(final).sort((a, b) => b[1] - a[1])[0];
    const oddsStr  =
      top[0] === "home" && m.odds?.odds_home ? ` · יחס ${m.odds.odds_home.toFixed(2)}` :
      top[0] === "draw" && m.odds?.odds_draw ? ` · יחס ${m.odds.odds_draw.toFixed(2)}` :
      top[0] === "away" && m.odds?.odds_away ? ` · יחס ${m.odds.odds_away.toFixed(2)}` : "";
    items.push({
      text: `🏆 מונדיאל | ${m.home_team} vs ${m.away_team} → ${OUTCOME_HE[top[0]]} ${Math.round(top[1] * 100)}%${oddsStr} · ביטחון ${conf}%`,
    });
  }

  // ── 2. Value bets from all other leagues ──────────────────────────────────
  const otherVB = matches.filter(m => !IS_WC(m) && m.value_bets &&
    Object.values(m.value_bets).some(v => v?.is_value_bet));
  for (const m of otherVB) {
    const entry = Object.entries(m.value_bets ?? {}).find(([, v]) => v?.is_value_bet);
    if (!entry) continue;
    const [outcome, vb] = entry;
    const oddsStr = vb.bookmaker_odds ? ` @ ${vb.bookmaker_odds.toFixed(2)}` : "";
    items.push({
      text: `⚡ Value Bet | ${m.home_team} vs ${m.away_team} → ${OUTCOME_HE[outcome]}${oddsStr} · Edge +${vb.edge_percent.toFixed(1)}%`,
    });
  }

  // ── 3. Fallback if no real data ────────────────────────────────────────────
  if (items.length === 0) {
    return [
      { text: "🏆 מונדיאל 2026 — בחירות המערכת: עדיפות לסיגנלים עם קונסנזוס + Value Bet" },
      { text: "⚡ Value Bet שזוהה? קבלו התראה מיידית בערוץ הטלגרם שלנו!" },
      { text: "🔬 ניתוח 360°: xG · מזג אוויר · שופט · פציעות · פסיכולוגיה · קונסנזוס" },
    ];
  }
  return items;
}

export default function WorldCupTicker({
  items,
  matches,
}: {
  items?:   TickerItem[];
  matches?: TickerMatch[];
}) {
  const resolvedItems = items ?? (matches ? buildTickerItems(matches) : [
    { text: "🏆 מונדיאל 2026 — בחירות המערכת: עדיפות לסיגנלים עם קונסנזוס + Value Bet" },
    { text: "⚡ Value Bet שזוהה? קבלו התראה מיידית בערוץ הטלגרם שלנו!" },
    { text: "🔬 ניתוח 360°: xG · מזג אוויר · שופט · פציעות · פסיכולוגיה · קונסנזוס" },
  ]);
  if (!resolvedItems.length) return null;

  // duplicate so the scroll feels seamless
  const allItems = [...resolvedItems, ...resolvedItems];

  return (
    <div
      style={{
        display: "flex",
        background: "linear-gradient(90deg, #1e293b, #0f172a)",
        color: "#ffffff",
        direction: "rtl",
        height: 40,
        alignItems: "center",
        borderBottom: "2px solid #38bdf8",
        overflow: "hidden",
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        zIndex: 9999,
      }}
    >
      {/* Fixed label */}
      <div
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
        🔥 המלצות מונדיאל לייב:
      </div>

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
    </div>
  );
}
