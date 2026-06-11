"use client";
import { useState } from "react";
import MatchCard from "./MatchCard";

/* ── League grouping config ── */
const LEAGUE_GROUPS = [
  { key: "world-cup",        label: "🏆 מונדיאל 2026",    match: (s: string) => /world.?cup|fifa|מונדיאל/i.test(s) },
  { key: "premier-league",   label: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 ליגה אנגלית",  match: (s: string) => /premier.?league/i.test(s) },
  { key: "la-liga",          label: "🇪🇸 ליגה ספרדית",    match: (s: string) => /la.?liga|laliga/i.test(s) },
  { key: "bundesliga",       label: "🇩🇪 בונדסליגה",       match: (s: string) => /bundesliga/i.test(s) },
  { key: "serie-a",          label: "🇮🇹 סריה א",          match: (s: string) => /serie.?a/i.test(s) },
  { key: "champions-league", label: "⭐ צ'מפיונס",         match: (s: string) => /champions.?league/i.test(s) },
  { key: "usl",              label: "🇺🇸 USL",              match: (s: string) => /^usl/i.test(s) },
  { key: "asean",            label: "🌏 אסיה",              match: (s: string) => /asean|asian|afc/i.test(s) },
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

  /* Build tab list — only show groups that have matches */
  const availableGroups = LEAGUE_GROUPS.filter(g =>
    matches.some(m => getGroupKey(m.league ?? "") === g.key)
  );

  const filtered = active === "all"
    ? matches
    : matches.filter(m => getGroupKey(m.league ?? "") === active);

  return (
    <>
      {/* ── Filter tabs ── */}
      {availableGroups.length > 0 && (
        <div style={{
          display: "flex", gap: 8, marginBottom: 24,
          overflowX: "auto", paddingBottom: 4,
          scrollbarWidth: "none",
        }}>
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
            const badgeBg = g.key === "world-cup" ? "#2ecc71" : "#3498db";
            return (
              <TabBtn
                key={g.key}
                label={`${g.label} (${count})`}
                active={active === g.key}
                onClick={() => setActive(g.key)}
                highlight={g.key === "world-cup"}
                badge={acc ? { text: `${acc.rate}% פגיעה`, bg: badgeBg } : undefined}
              />
            );
          })}
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
  label, active, onClick, highlight = false, badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  highlight?: boolean;
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
        border: active
          ? highlight ? "1px solid rgba(234,179,8,0.6)" : "1px solid rgba(16,185,129,0.5)"
          : "1px solid rgba(255,255,255,0.1)",
        background: active
          ? highlight ? "rgba(234,179,8,0.15)" : "rgba(16,185,129,0.12)"
          : "rgba(255,255,255,0.04)",
        color: active
          ? highlight ? "#fbbf24" : "#10b981"
          : "#64748b",
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
