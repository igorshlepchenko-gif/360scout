"use client";
import { useState } from "react";
import LeagueFilteredMatches from "./LeagueFilteredMatches";
import LiveInPlayTab from "./LiveInPlayTab";
import type { LiveMatch } from "./MatchLiveRow";

type LeagueAccuracyRow = { league: string; total: number; correct: number; rate: number };
type TabId = "all" | "live";

const PANELS: Record<TabId, string> = {
  all:  "panel-all",
  live: "panel-live",
};

export default function DashboardTabs({
  matches,
  leagueAccuracy = [],
  globalAccuracy = null,
}: {
  matches: any[];
  leagueAccuracy?: LeagueAccuracyRow[];
  globalAccuracy?: number | null;
}) {
  const [tab, setTab] = useState<TabId>("all");

  const liveMatches = matches.filter((m: any) => m._status === "live");
  const liveCount   = liveMatches.length;

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
    </div>
  );
}
