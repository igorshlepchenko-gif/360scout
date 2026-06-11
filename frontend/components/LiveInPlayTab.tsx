"use client";
import React from "react";
import { Play, TrendingUp, Zap, Clock } from "lucide-react";

interface LiveMatchValue {
  id: string;
  time: string;
  score: string;
  homeTeam: string;
  awayTeam: string;
  currentMarketOdds: number;
  algoFairOdds: number;
  valueEdge: number;
  marketPick: string;
  momentum: "home" | "away" | "neutral";
}

const liveValuesData: LiveMatchValue[] = [
  {
    id: "live1",
    time: "64'",
    score: "0 - 0",
    homeTeam: "Arsenal",
    awayTeam: "West Ham",
    marketPick: "ארסנל מנצחת (1)",
    currentMarketOdds: 2.15,
    algoFairOdds: 1.80,
    valueEdge: 9.1,
    momentum: "home",
  },
  {
    id: "live2",
    time: "42'",
    score: "1 - 2",
    homeTeam: "Ajax",
    awayTeam: "Feyenoord",
    marketPick: "אובר 4.5 שערים",
    currentMarketOdds: 1.95,
    algoFairOdds: 1.72,
    valueEdge: 6.8,
    momentum: "neutral",
  },
];

export default function LiveInPlayTab() {
  return (
    <div className="w-full mt-10">

      {/* ── Header banner ── */}
      <div className="mb-6 rounded-xl border border-red-500/20 p-4 flex items-center gap-4"
        style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.06), rgba(245,158,11,0.06))" }}>
        <div className="flex items-center gap-2 bg-red-500 text-black font-bold px-2.5 py-1 rounded text-xs animate-pulse shrink-0">
          <Play size={10} fill="currentColor" />
          LIVE
        </div>
        <div>
          <h3 className="font-bold text-white text-sm">הזדמנויות ערך בליין רץ (In-Play)</h3>
          <p className="text-slate-400 text-xs mt-0.5">
            האלגוריתם סורק שינויים בשוק בהתאם להתפתחות המשחק ומזהה תמחור שגוי של הבוקמייקרים בזמן אמת.
          </p>
        </div>
      </div>

      {/* ── Match cards ── */}
      <div className="space-y-4">
        {liveValuesData.map((match) => (
          <div
            key={match.id}
            className="rounded-xl border border-slate-800 overflow-hidden transition-all hover:border-slate-700"
            style={{ background: "#0F1318" }}
          >
            {/* ── Match header ── */}
            <div className="px-4 py-2.5 border-b border-slate-800/60 flex justify-between items-center text-xs"
              style={{ background: "rgba(0,0,0,0.25)" }}>
              <div className="flex items-center gap-2">
                <span className="text-red-400 font-bold font-mono flex items-center gap-1 bg-red-500/10 px-1.5 py-0.5 rounded">
                  <Clock size={12} />
                  {match.time}
                </span>
                <span className="text-slate-600">|</span>
                <span className="font-bold font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                  {match.score}
                </span>
                {/* direction:ltr so home always appears left of "vs" */}
                <span className="text-slate-200 font-medium mr-2" style={{ direction: "ltr" }}>
                  {match.homeTeam} vs {match.awayTeam}
                </span>
              </div>
              <div className="text-[11px]">
                {match.momentum === "home"    && <span className="text-emerald-400 font-medium">🔥 לחץ כבד של הבית</span>}
                {match.momentum === "away"    && <span className="text-amber-400  font-medium">🔥 לחץ כבד של האורחים</span>}
                {match.momentum === "neutral" && <span className="text-slate-500">משחק מאוזן</span>}
              </div>
            </div>

            {/* ── Value details ── */}
            <div className="p-4 grid grid-cols-1 md:grid-cols-4 items-center gap-4 text-xs">

              {/* Recommended bet */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-500">ההימור המומלץ</span>
                <span className="font-bold text-slate-200 text-sm flex items-center gap-1">
                  <Zap size={14} className="text-amber-400 fill-amber-400" />
                  {match.marketPick}
                </span>
              </div>

              {/* Odds comparison */}
              <div className="flex justify-around p-2 rounded-lg border border-slate-800 text-center font-mono"
                style={{ background: "rgba(0,0,0,0.3)" }}>
                <div>
                  <span className="block text-[10px] text-slate-500">יחס בוקמייקר</span>
                  <span className="text-sm font-bold text-slate-200">{match.currentMarketOdds.toFixed(2)}</span>
                </div>
                <div className="w-px bg-slate-800 my-1" />
                <div>
                  <span className="block text-[10px] text-slate-500">יחס הוגן (אלגו)</span>
                  <span className="text-sm font-semibold text-slate-400">{match.algoFairOdds.toFixed(2)}</span>
                </div>
              </div>

              {/* Edge badge */}
              <div className="text-right md:text-center">
                <span className="block text-[10px] text-slate-500 mb-0.5">יתרון ערך (Edge)</span>
                <span className="inline-block bg-emerald-500/10 text-emerald-400 font-bold font-mono px-3 py-1 rounded text-sm">
                  +{match.valueEdge}% Value
                </span>
              </div>

              {/* CTA */}
              <div className="flex justify-end">
                <a
                  href="https://t.me/Malmilyan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full md:w-auto bg-red-500 hover:bg-red-600 text-black font-bold px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors text-xs shadow-lg shadow-red-500/10"
                >
                  <TrendingUp size={14} />
                  קבל התראת לייב בטלגרם
                </a>
              </div>

            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
