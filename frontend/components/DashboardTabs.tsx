"use client";
import { useState } from "react";
import LeagueFilteredMatches from "./LeagueFilteredMatches";
import LiveInPlayTab from "./LiveInPlayTab";
import type { LiveMatch } from "./MatchLiveRow";

type LeagueAccuracyRow = { league: string; total: number; correct: number; rate: number };
type TabId = "all" | "live" | "worldcup";

const IS_WORLD_CUP = (m: any) => /world.?cup|fifa|מונדיאל/i.test(m.league ?? "");

const PANELS: Record<TabId, string> = {
  all:      "panel-all",
  live:     "panel-live",
  worldcup: "panel-worldcup",
};

export default function DashboardTabs({
  matches,
  wcMatches = [],
  leagueAccuracy = [],
  globalAccuracy = null,
}: {
  matches: any[];
  wcMatches?: any[];
  leagueAccuracy?: LeagueAccuracyRow[];
  globalAccuracy?: number | null;
}) {
  const [tab, setTab] = useState<TabId>("all");

  const liveMatches = matches.filter((m: any) => m._status === "live");
  const liveCount   = liveMatches.length;
  const wcCount     = wcMatches.length;

  return (
    <div>
      {/* ── Tab bar ── */}
      <div className="tabs-navigation" role="tablist" aria-label="סינון משחקים">
        <button
          role="tab"
          id="tab-all"
          aria-selected={tab === "all"}
          aria-controls={PANELS.all}
          className={`tab-btn${tab === "all" ? " active" : ""}`}
          onClick={() => setTab("all")}
        >
          כל המשחקים ({matches.length})
        </button>

        <button
          role="tab"
          id="tab-live"
          aria-selected={tab === "live"}
          aria-controls={PANELS.live}
          className={`tab-btn${tab === "live" ? " active" : ""}`}
          onClick={() => setTab("live")}
        >
          {liveCount > 0 && (
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 7, height: 7,
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
          role="tab"
          id="tab-worldcup"
          aria-selected={tab === "worldcup"}
          aria-controls={PANELS.worldcup}
          className={`tab-btn worldcup-tab${tab === "worldcup" ? " active" : ""}`}
          onClick={() => setTab("worldcup")}
        >
          🏆 מונדיאל 2026{wcCount > 0 ? ` (${wcCount})` : ""}
        </button>
      </div>

      {/* ── Tab panels ── */}
      <div role="tabpanel" id={PANELS.all} aria-labelledby="tab-all" hidden={tab !== "all"}>
        {tab === "all" && (
          <LeagueFilteredMatches
            matches={matches}
            leagueAccuracy={leagueAccuracy}
            globalAccuracy={globalAccuracy}
          />
        )}
      </div>

      <div role="tabpanel" id={PANELS.live} aria-labelledby="tab-live" hidden={tab !== "live"}>
        {tab === "live" && (
          <LiveInPlayTab matches={liveMatches as LiveMatch[]} />
        )}
      </div>

      <div role="tabpanel" id={PANELS.worldcup} aria-labelledby="tab-worldcup" hidden={tab !== "worldcup"}>
        {tab === "worldcup" && (
          wcCount > 0 ? (
            <LeagueFilteredMatches
              matches={wcMatches}
              leagueAccuracy={leagueAccuracy.filter(r => IS_WORLD_CUP({ league: r.league }))}
              globalAccuracy={globalAccuracy}
            />
          ) : (
            <div style={{
              textAlign: "center", padding: "48px 0",
              background: "#0F1318",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 16,
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }} aria-hidden="true">🏆</div>
              <div style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600 }}>
                אין משחקי מונדיאל בטווח הקרוב
              </div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>
                המשחקים הבאים יופיעו כאן אוטומטית ברגע שיתפרסם לוח הזמנים
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
