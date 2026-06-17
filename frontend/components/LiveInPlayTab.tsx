"use client";
import { Play, RefreshCw } from "lucide-react";
import MatchLiveRow, { type LiveMatch } from "./MatchLiveRow";
import { useLivePolling } from "@/hooks/useLivePolling";

export default function LiveInPlayTab({ matches: initialMatches = [] }: { matches?: LiveMatch[] }) {
  const { matches: allMatches, lastUpdated, isPending } = useLivePolling(
    initialMatches as LiveMatch[]
  );

  const live = allMatches.filter(m => m._status === "live");

  return (
    <div className="mt-10 w-full">

      {/* ── Header banner ── */}
      <div
        className="mb-6 flex items-center gap-4 rounded-xl border border-red-500/20 p-4"
        style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.06), rgba(245,158,11,0.06))" }}
      >
        <div className="flex shrink-0 animate-pulse items-center gap-2 rounded bg-red-500 px-2.5 py-1 text-xs font-bold text-black">
          <Play size={10} fill="currentColor" />
          LIVE
        </div>

        <div>
          <h3 className="text-sm font-bold text-white">משחקים בליין רץ (In-Play)</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {lastUpdated
              ? `עודכן: ${lastUpdated.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
              : "ממתין לעדכון ראשון..."}
          </p>
        </div>

        <span className="mr-auto rounded-full bg-red-500/10 px-2.5 py-1 font-mono text-xs font-bold text-red-400">
          {live.length} חיים כרגע
        </span>

        {/* Spinner shown while a fetch is in-flight */}
        {isPending && (
          <RefreshCw
            size={13}
            className="text-slate-600"
            style={{ animation: "spin 1s linear infinite" }}
          />
        )}
      </div>

      {/* ── Empty state ── */}
      {live.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#0F1318] py-10 text-center">
          <div className="mb-2 text-2xl">⏱️</div>
          <div className="text-sm text-slate-400">אין משחקים חיים ברגע זה</div>
          <div className="mt-1 text-xs text-slate-600">
            ברגע שמשחק מנוטר ייכנס לליין הרץ — הוא יופיע כאן עם השעון בזמן אמת
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {live.map(m => (
            <MatchLiveRow key={m.fixture_id} match={m} />
          ))}
          <p className="text-center text-[10px] text-slate-600">
            היחס ההוגן מבוסס על מודל טרום-משחק — אינו מתעדכן לפי מהלך המשחק. למטרות מחקר בלבד.
          </p>
        </div>
      )}
    </div>
  );
}
