import React from 'react';
import { Shield, Flame, User, CloudRain, Activity, Award } from 'lucide-react';

// נתוני דמה (Mock Data) להמחשת המערכת
const sampleMatch = {
  homeTeam: "מנצ'סטר סיטי",
  awayTeam: "ארסנל",
  league: "פרמייר ליג",
  time: "22:00",
  metrics: {
    homeXG: "2.10",
    awayXG: "1.65",
    homeForm: "WWWDW",
    awayForm: "WLDWW",
    referee: "מייקל אוליבר (נטייה גבוהה לכרטיסים)",
    weather: "גשם קל (משפיע על מהירות כדור)",
  },
  winningMethod: {
    homeProb: "52%",
    drawProb: "23%",
    awayProb: "25%",
    confidence: "גבוהה (8/10)",
    valueDetected: true,
    recommendation: "ניצחון ביתי (1) / מעל 2.5 שערים"
  }
};

export default function MatchAnalysisCard() {
  const match = sampleMatch;

  return (
    <div className="max-w-2xl mx-auto my-6 p-1 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl shadow-2xl dir-rtl">
      <div className="bg-slate-900 text-slate-100 rounded-[14px] p-5 md:p-6 space-y-6">

        {/* כותרת המשחק והליגה */}
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <span className="text-xs font-semibold tracking-wider text-cyan-400 uppercase bg-cyan-950/50 px-2.5 py-1 rounded-full">
              {match.league}
            </span>
            <div className="flex items-center gap-3 mt-2">
              <h3 className="text-lg md:text-xl font-bold font-sans">{match.homeTeam}</h3>
              <span className="text-sm text-slate-500 font-medium">נגד</span>
              <h3 className="text-lg md:text-xl font-bold font-sans">{match.awayTeam}</h3>
            </div>
          </div>
          <div className="text-left">
            <span className="block text-2xl font-mono font-bold text-slate-200">{match.time}</span>
            <span className="text-xs text-slate-400 font-medium">היום</span>
          </div>
        </div>

        {/* חלק 1: מדדי עומק דינמיים */}
        <div className="space-y-4">
          <h4 className="text-xs font-bold text-slate-400 tracking-wide uppercase flex items-center gap-1.5">
            <Activity size={14} className="text-cyan-400" />
            מדדי עומק ומשתנים סביבתיים
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* מדד xG */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <Award size={16} className="text-slate-500" /> שערים צפויים (xG)
              </span>
              <span className="font-mono font-bold text-sm text-slate-200">
                {match.metrics.homeXG} - {match.metrics.awayXG}
              </span>
            </div>

            {/* כושר נוכחי */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <Flame size={16} className="text-slate-500" /> מומנטום (5 משחקים)
              </span>
              <span className="font-mono text-xs tracking-wider text-emerald-400 font-bold">
                {match.metrics.homeForm} | <span className="text-slate-400">{match.metrics.awayForm}</span>
              </span>
            </div>

            {/* נתוני שופט */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 flex justify-between items-center md:col-span-2">
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <User size={16} className="text-slate-500" /> השפעת שופט
              </span>
              <span className="text-xs text-slate-300 font-medium">{match.metrics.referee}</span>
            </div>

            {/* מזג אוויר */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 flex justify-between items-center md:col-span-2">
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <CloudRain size={16} className="text-slate-500" /> תנאי מגרש ומזג אוויר
              </span>
              <span className="text-xs text-slate-300 font-medium">{match.metrics.weather}</span>
            </div>
          </div>
        </div>

        {/* חלק 2: שורת המסקנה - The Winning Method */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-850 p-4 rounded-xl border border-slate-700/60 space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 flex items-center gap-1.5">
              <Shield size={16} className="text-cyan-400" />
              The Winning Method — סיכום אנליטי
            </h4>
            {match.winningMethod.valueDetected && (
              <span className="flex items-center gap-1 text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md animate-pulse">
                <Flame size={12} /> מצאתי ערך (Value)
              </span>
            )}
          </div>

          {/* התפלגות הסתברויות */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <span className="block text-[11px] text-slate-500 font-bold">ביתי (1)</span>
              <span className="text-lg font-mono font-black text-cyan-400">{match.winningMethod.homeProb}</span>
            </div>
            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <span className="block text-[11px] text-slate-500 font-bold">תיקו (X)</span>
              <span className="text-lg font-mono font-black text-slate-400">{match.winningMethod.drawProb}</span>
            </div>
            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <span className="block text-[11px] text-slate-500 font-bold">אורחת (2)</span>
              <span className="text-lg font-mono font-black text-blue-400">{match.winningMethod.awayProb}</span>
            </div>
          </div>

          {/* שורת המלצה ורמת ביטחון */}
          <div className="pt-2 border-t border-slate-700/40 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <div>
              <span className="text-xs text-slate-400 block">רמת ביטחון מודל:</span>
              <span className="text-sm font-bold text-slate-200">{match.winningMethod.confidence}</span>
            </div>
            <div className="bg-cyan-950/40 border border-cyan-500/30 px-4 py-2 rounded-lg text-right sm:text-left">
              <span className="text-[10px] text-cyan-400 block font-bold uppercase tracking-wider">המלצת המערכת</span>
              <span className="text-sm font-black text-cyan-200">{match.winningMethod.recommendation}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
