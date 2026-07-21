"use client";
import { useState, useRef, useEffect } from "react";
import MatchCard from "./MatchCard";

/* ── League grouping config — Tier 1 & Tier 2 whitelist ── */
const LEAGUE_GROUPS = [
  // International first — most prominent
  { key: "euros-copa",       label: "🌍 יורו / קופה",        match: (s: string) => /\beuro\b|copa.?america|nations.?cup/i.test(s) },
  { key: "champions-league", label: "⭐ צ'מפיונס",           match: (s: string) => /champions.?league/i.test(s) },
  { key: "europa",           label: "🟠 אירופה / קונפרנס",   match: (s: string) => /europa.?league|conference.?league/i.test(s) },
  // Tier 1 European leagues
  { key: "premier-league",   label: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 ליגה אנגלית",    match: (s: string) => /premier.?league/i.test(s) },
  { key: "championship",     label: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 צ'מפיונשיפ",      match: (s: string) => /\bchampionship\b/i.test(s) },
  { key: "la-liga",          label: "🇪🇸 ליגה ספרדית",       match: (s: string) => /la.?liga|laliga/i.test(s) },
  { key: "bundesliga",       label: "🇩🇪 בונדסליגה",         match: (s: string) => /bundesliga/i.test(s) },
  { key: "serie-a",          label: "🇮🇹 סריה א",            match: (s: string) => /serie.?a/i.test(s) },
  { key: "ligue-1",          label: "🇫🇷 ליג 1",             match: (s: string) => /ligue.?1/i.test(s) },
  { key: "eredivisie",       label: "🇳🇱 ארדיביזיה",         match: (s: string) => /eredivisie/i.test(s) },
  { key: "primeira",         label: "🇵🇹 פורטוגל",           match: (s: string) => /primeira|liga.?portugal/i.test(s) },
  // Tier 2
  { key: "saudi",            label: "🇸🇦 ערב הסעודית",       match: (s: string) => /saudi|roshn/i.test(s) },
  { key: "mls",              label: "🇺🇸 MLS",               match: (s: string) => /\bmls\b|major.?league.?soccer/i.test(s) },
  { key: "israel",           label: "🇮🇱 ישראל",             match: (s: string) => /israel|ligat/i.test(s) },
];

function getGroupKey(league: string): string {
  return LEAGUE_GROUPS.find(g => g.match(league))?.key ?? "other";
}

type LeagueAccuracyRow = { league: string; total: number; correct: number; rate: number };

function getGroupAccuracy(
  groupKey: string,
  leagueAccuracy: LeagueAccuracyRow[],
): { rate: number; total: number } | null {
  const group = LEAGUE_GROUPS.find(g => g.key === groupKey);
  if (!group) return null;
  const rows = leagueAccuracy.filter(r => group.match(r.league ?? ""));
  const total   = rows.reduce((s, r) => s + r.total,   0);
  const correct = rows.reduce((s, r) => s + r.correct, 0);
  if (!total) return null;
  return { rate: Math.round((correct / total) * 1000) / 10, total };
}

export default function LeagueFilteredMatches({
  matches,
  leagueAccuracy = [],
  globalAccuracy = null,
}: {
  matches: any[];
  leagueAccuracy?: LeagueAccuracyRow[];
  globalAccuracy?: number | null;
}) {
  const [active, setActive] = useState("all");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  // dedupe — the live feed occasionally returns the same fixture twice
  const seen = new Set<number>();
  matches = matches.filter(m => {
    if (seen.has(m.fixture_id)) return false;
    seen.add(m.fixture_id);
    return true;
  });

  /* Build tab list — only show groups that have matches */
  const availableGroups = LEAGUE_GROUPS.filter(g =>
    matches.some(m => getGroupKey(m.league ?? "") === g.key)
  );

  // Priority sort for "all" tab: value bets → LOCK consensus → rest
  const hasValueBet = (m: any) =>
    m.value_bets && Object.values(m.value_bets as Record<string, any>).some((v: any) => v?.is_value_bet);

  function matchPriority(m: any): number {
    if (hasValueBet(m))             return 0; // value bet in any league
    if (m.consensus?.type === "LOCK") return 1; // consensus lock
    return 2;                                   // everything else
  }

  const rawFiltered = active === "all"
    ? matches
    : matches.filter((m: any) => getGroupKey(m.league ?? "") === active);

  const filtered = active === "all"
    ? [...rawFiltered].sort((a, b) => matchPriority(a) - matchPriority(b))
    : rawFiltered;

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const check = () => setHasOverflow(el.scrollWidth > el.clientWidth + 4);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [matches]);

  function scrollTabs(dir: "start" | "end") {
    tabsRef.current?.scrollBy({ left: dir === "end" ? 140 : -140, behavior: "smooth" });
  }

  return (
    <>
      {/* ── Filter tabs ── */}
      {availableGroups.length > 0 && (
        <div style={{ position: "relative", marginBottom: 24 }}>

          {/* Scroll arrow — ימין (לטאבים הראשונים) */}
          {hasOverflow && (
            <button
              onClick={() => scrollTabs("start")}
              aria-label="גלול ימינה"
              style={{
                position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
                zIndex: 10,
                width: 28, height: 28, borderRadius: "50%",
                background: "rgba(15,19,24,0.92)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "#94a3b8", fontSize: 16, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "-6px 0 12px rgba(11,14,20,0.9)",
              }}
            >›</button>
          )}

          {/* Scroll arrow — שמאל (לטאבים האחרונים) */}
          {hasOverflow && (
            <button
              onClick={() => scrollTabs("end")}
              aria-label="גלול שמאלה"
              style={{
                position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
                zIndex: 10,
                width: 28, height: 28, borderRadius: "50%",
                background: "rgba(15,19,24,0.92)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "#94a3b8", fontSize: 16, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "6px 0 12px rgba(11,14,20,0.9)",
              }}
            >‹</button>
          )}

          {/* Tabs scroll container */}
          <div
            ref={tabsRef}
            style={{
              display: "flex", gap: 8,
              overflowX: "auto", paddingBottom: 4,
              scrollbarWidth: "none",
              /* leave room for arrows when overflow */
              paddingLeft: hasOverflow ? 36 : 0,
              paddingRight: hasOverflow ? 36 : 0,
            }}
          >
            {/* "All" tab always first */}
            <TabBtn
              label={`כל המשחקים (${matches.length})`}
              active={active === "all"}
              onClick={() => setActive("all")}
              badge={globalAccuracy != null ? { text: `${globalAccuracy}% דיוק`, bg: "#e67e22" } : undefined}
            />
            {availableGroups.map(g => {
              const count = matches.filter(m => getGroupKey(m.league ?? "") === g.key).length;
              const acc   = getGroupAccuracy(g.key, leagueAccuracy);
              return (
                <TabBtn
                  key={g.key}
                  label={`${g.label} (${count})`}
                  active={active === g.key}
                  onClick={() => setActive(g.key)}
                  badge={acc ? { text: `${acc.rate}% פגיעה`, bg: "#3498db" } : undefined}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Match cards ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(560px, 1fr))",
        gap: 24,
      }}>
        {filtered.map((m: any) => (
          <MatchCard
            key={m.fixture_id}
            homeTeam={m.home_team}
            awayTeam={m.away_team}
            homeLogo={m.home_logo}
            awayLogo={m.away_logo}
            league={m.league}
            leagueLogo={m.league_logo}
            matchDate={m.match_date}
            isLive={m._status === "live"}
            prediction={m.prediction}
            value_bets={m.value_bets}
            consensus={m.consensus}
            fixtureId={m.fixture_id}
            matchId={String(m.fixture_id)}
            odds={m.odds}
            weather={m.weather}
            xg={m.xg}
            goals_signal={m.goals_signal}
            ou_edge={m.ou_edge}
            handicap_signal={m.handicap_signal}
            lineups={m.lineups}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{
            gridColumn: "1 / -1", textAlign: "center",
            color: "#475569", fontSize: 14, padding: "40px 0",
          }}>
            אין משחקים בליגה זו כרגע
          </div>
        )}
      </div>
    </>
  );
}

function TabBtn({
  label, active, onClick, badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: { text: string; bg: string };
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 16px",
        borderRadius: 99,
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        whiteSpace: "nowrap",
        cursor: "pointer",
        transition: "all 0.18s",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: active ? "1px solid rgba(16,185,129,0.5)" : "1px solid rgba(255,255,255,0.1)",
        background: active ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)",
        color: active ? "#10b981" : "#64748b",
      }}
    >
      {label}
      {badge && (
        <span style={{
          background: badge.bg,
          color: "white",
          fontSize: 10,
          fontWeight: 700,
          padding: "1px 6px",
          borderRadius: 99,
          lineHeight: 1.6,
        }}>
          {badge.text}
        </span>
      )}
    </button>
  );
}
