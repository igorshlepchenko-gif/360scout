import React from 'react';
import { Shield, Flame, User, CloudRain, Activity, Award } from 'lucide-react';

interface MatchData {
  fixture_id?: number;
  home_team?: string;
  away_team?: string;
  league?: string;
  match_date?: string;
  xg?: { home: number; away: number };
  form?: { home: string; away: string };
  referee?: string;
  weather?: { temperature_celsius?: number; description?: string } | null;
  prediction?: {
    final?: { home: number; draw: number; away: number };
    adjusted?: { home: number; draw: number; away: number } | null;
    confidence?: number;
  } | null;
  value_bets?: Record<string, { is_value_bet?: boolean; edge_percent?: number; bookmaker_odds?: number } | null> | null;
}

// נתוני דמה כ-fallback
const FALLBACK: MatchData = {
  fixture_id: 0,
  home_team: "מנצ'סטר סיטי",
  away_team: "ארסנל",
  league: "פרמייר ליג",
  match_date: "22:00",
  xg:   { home: 2.10, away: 1.65 },
  form: { home: "WWWDW", away: "WLDWW" },
  referee: "מייקל אוליבר",
  weather: { temperature_celsius: 14, description: "גשם קל" },
  prediction: {
    final:      { home: 0.52, draw: 0.23, away: 0.25 },
    confidence: 78,
  },
  value_bets: {
    home: { is_value_bet: false, edge_percent: 3,  bookmaker_odds: 1.85 },
    draw: { is_value_bet: false, edge_percent: -2, bookmaker_odds: 3.60 },
    away: { is_value_bet: true,  edge_percent: 22, bookmaker_odds: 6.09 },
  },
};

function fmt(n: number): string {
  return (n * 100).toFixed(0) + '%';
}

export default function MatchAnalysisCard({ matchData }: { matchData?: MatchData }) {
  const m     = matchData ?? FALLBACK;
  const probs = m.prediction?.adjusted ?? m.prediction?.final;
  const conf  = m.prediction?.confidence ?? 0;

  const valueDetected = Object.values(m.value_bets ?? {}).some(v => v?.is_value_bet);

  const weatherStr = m.weather
    ? `${m.weather.temperature_celsius ?? '?'}°C${m.weather.description ? ' — ' + m.weather.description : ''}`
    : 'לא ידוע';

  const refereeStr = m.referee || 'לא ידוע';

  return (
    <div className="max-w-2xl mx-auto my-6 p-1 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl shadow-2xl dir-rtl">
      <div className="bg-slate-900 text-slate-100 rounded-[14px] p-5 md:p-6 space-y-6">

        {/* כותרת המשחק והליגה */}
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <span className="text-xs font-semibold tracking-wider text-cyan-400 uppercase bg-cyan-950/50 px-2.5 py-1 rounded-full">
              {m.league}
            </span>
            <div className="flex items-center gap-3 mt-2">
              <h3 className="text-lg md:text-xl font-bold font-sans">{m.home_team}</h3>
              <span className="text-sm text-slate-500 font-medium">נגד</span>
              <h3 className="text-lg md:text-xl font-bold font-sans">{m.away_team}</h3>
            </div>
          </div>
          <div className="text-left">
            <span className="block text-2xl font-mono font-bold text-slate-200">{m.match_date}</span>
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
            {/* xG */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <Award size={16} className="text-slate-500" /> שערים צפויים (xG)
              </span>
              <span className="font-mono font-bold text-sm text-slate-200">
                {(m.xg?.home ?? 0).toFixed(2)} - {(m.xg?.away ?? 0).toFixed(2)}
              </span>
            </div>

            {/* Form */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <Flame size={16} className="text-slate-500" /> מומנטום (5 משחקים)
              </span>
              <span className="font-mono text-xs tracking-wider text-emerald-400 font-bold">
                {m.form?.home ?? '—'} | <span className="text-slate-400">{m.form?.away ?? '—'}</span>
              </span>
            </div>

            {/* שופט */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 flex justify-between items-center md:col-span-2">
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <User size={16} className="text-slate-500" /> השפעת שופט
              </span>
              <span className="text-xs text-slate-300 font-medium">{refereeStr}</span>
            </div>

            {/* מזג אוויר */}
            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-800 flex justify-between items-center md:col-span-2">
              <span className="text-sm text-slate-400 flex items-center gap-2">
                <CloudRain size={16} className="text-slate-500" /> תנאי מגרש ומזג אוויר
              </span>
              <span className="text-xs text-slate-300 font-medium">{weatherStr}</span>
            </div>
          </div>
        </div>

        {/* חלק 2: The Winning Method */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-850 p-4 rounded-xl border border-slate-700/60 space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 flex items-center gap-1.5">
              <Shield size={16} className="text-cyan-400" />
              The Winning Method — סיכום אנליטי
            </h4>
            {valueDetected && (
              <span className="flex items-center gap-1 text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md animate-pulse">
                <Flame size={12} /> מצאתי ערך (Value)
              </span>
            )}
          </div>

          {/* הסתברויות + יחסים */}
          <div className="grid grid-cols-3 gap-2 text-center my-3">
            {(['home', 'draw', 'away'] as const).map((outcome) => {
              const vb      = (m.value_bets ?? {})[outcome];
              const isValue = vb?.is_value_bet ?? false;
              const odds    = vb?.bookmaker_odds;
              const prob    = probs?.[outcome];
              const label   = outcome === 'home' ? 'בית (1)' : outcome === 'draw' ? 'תיקו (X)' : 'אורחים (2)';

              return isValue ? (
                <div key={outcome} className="bg-emerald-950/20 p-2 rounded-lg border border-emerald-500/30">
                  <span className="block text-[11px] text-emerald-400 font-medium">{label}</span>
                  <span className="text-base font-mono font-bold text-emerald-400">
                    {prob != null ? fmt(prob) : '—'}
                  </span>
                  {odds != null && (
                    <span className="block text-xs font-mono text-emerald-300 mt-0.5 font-bold">
                      יחס: {odds.toFixed(2)}
                    </span>
                  )}
                </div>
              ) : (
                <div key={outcome} className="bg-slate-800/50 p-2 rounded-lg border border-slate-700/40">
                  <span className="block text-[11px] text-slate-400">{label}</span>
                  <span className="text-base font-mono font-bold text-slate-200">
                    {prob != null ? fmt(prob) : '—'}
                  </span>
                  {odds != null && (
                    <span className="block text-xs font-mono text-slate-500 mt-0.5">
                      יחס: {odds.toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* ביטחון */}
          <div className="pt-2 border-t border-slate-700/40 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <div>
              <span className="text-xs text-slate-400 block">רמת ביטחון מודל:</span>
              <span className="text-sm font-bold text-slate-200">{conf}%</span>
            </div>
            {probs && (
              <div className="bg-cyan-950/40 border border-cyan-500/30 px-4 py-2 rounded-lg text-right sm:text-left">
                <span className="text-[10px] text-cyan-400 block font-bold uppercase tracking-wider">המלצת המערכת</span>
                <span className="text-sm font-black text-cyan-200">
                  {probs.home >= probs.away && probs.home >= probs.draw
                    ? 'ניצחון ביתי (1)'
                    : probs.away >= probs.home && probs.away >= probs.draw
                    ? 'ניצחון אורחת (2)'
                    : 'תיקו (X)'}
                </span>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
