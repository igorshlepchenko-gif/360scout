"use client";
import { useState } from "react";
import LeagueFilteredMatches from "./LeagueFilteredMatches";
import LiveInPlayTab from "./LiveInPlayTab";
import type { LiveMatch } from "./MatchLiveRow";

type LeagueAccuracyRow = { league: string; total: number; correct: number; rate: number };

const IS_WORLD_CUP = (m: any) => /world.?cup|fifa|מונדיאל/i.test(m.league ?? "");

export default function DashboardTabs({
  matches,
  leagueAccuracy = [],
  globalAccuracy = null,
}: {
  matches: any[];
  leagueAccuracy?: LeagueAccuracyRow[];
  globalAccuracy?: number | null;
}) {
  const [tab, setTab] = useState<"all" | "live" | "worldcup">("all");

  const liveMatches  = matches.filter((m: any) => m._status === "live");
  const wcMatches    = matches.filter(IS_WORLD_CUP);

  const liveCount = liveMatches.length;
  const wcCount   = wcMatches.length;

  return (
    <div>
      {/* ── Top tab bar ── */}
      <div className="tabs-navigation">
        <button
          className={`tab-btn${tab === "all" ? " active" : ""}`}
          onClick={() => setTab("all")}
        >
          כל המשחקים ({matches.length})
        </button>

        <button
          className={`tab-btn${tab === "live" ? " active" : ""}`}
          onClick={() => setTab("live")}
        >
          {liveCount > 0 && (
            <span
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#ef4444",
                marginLeft: 6,
                verticalAlign: "middle",
                animation: "pulse 1.5s infinite",
              }}
            />
          )}
          🔴 לייב{liveCount > 0 ? ` (${liveCount})` : ""}
        </button>

        <button
          className={`tab-btn worldcup-tab${tab === "worldcup" ? " active" : ""}`}
          onClick={() => setTab("worldcup")}
        >
          🏆 מונדיאל 2026{wcCount > 0 ? ` (${wcCount})` : ""}
        </button>
      </div>

      {/* ── Tab content ── */}
      {tab === "all" && (
        <LeagueFilteredMatches
          matches={matches}
          leagueAccuracy={leagueAccuracy}
          globalAccuracy={globalAccuracy}
        />
      )}

      {tab === "live" && (
        <LiveInPlayTab matches={liveMatches as LiveMatch[]} />
      )}

      {tab === "worldcup" && (
        wcCount > 0 ? (
          <LeagueFilteredMatches
            matches={wcMatches}
            leagueAccuracy={leagueAccuracy.filter(r => IS_WORLD_CUP({ league: r.league }))}
            globalAccuracy={globalAccuracy}
          />
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "48px 0",
              background: "#0F1318",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 16,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
            <div style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600 }}>
              אין משחקי מונדיאל היום
            </div>
            <div style={{ color: "#475569", fontSize: 12, marginTop: 6 }}>
              מונדיאל 2026 מתחיל ב-11/6/2026 — המשחקים יופיעו כאן אוטומטית
            </div>
          </div>
        )
      )}
    </div>
  );
}
