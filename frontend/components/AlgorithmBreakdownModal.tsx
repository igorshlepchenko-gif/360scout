"use client";

import { useEffect } from "react";
import {
  X, BarChart3, CloudRain, HeartPulse, Brain,
  Target, Dice5, Sparkles, TrendingUp, Info, Activity,
} from "lucide-react";

/* ── Types (match the backend prediction shape) ─────────────────────────── */
interface ModuleProbs { home: number; draw: number; away: number }

export interface Prediction {
  final: ModuleProbs;
  by_module: {
    stats: ModuleProbs;
    environment: ModuleProbs;
    human: ModuleProbs;
    psychology: ModuleProbs;
  };
  monte_carlo: ModuleProbs & { simulations: number };
  confidence: number;
  key_factors: Array<{ factor: string; impact: string; detail: string }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  homeTeam: string;
  awayTeam: string;
  prediction: Prediction;
}

/* ── Static config ──────────────────────────────────────────────────────── */
const MODULES = [
  { key: "stats",       label: "סטטיסטיקה",   sub: "xG · צורה · H2H",      weight: 40, Icon: BarChart3, color: "text-emerald-400", bar: "bg-emerald-500" },
  { key: "human",       label: "גורם אנושי",  sub: "פציעות · שופט",        weight: 25, Icon: HeartPulse, color: "text-rose-400",    bar: "bg-rose-500" },
  { key: "environment", label: "סביבה",       sub: "מזג אוויר · גובה",     weight: 20, Icon: CloudRain,  color: "text-sky-400",     bar: "bg-sky-500" },
  { key: "psychology",  label: "פסיכולוגיה",  sub: "קהל · לחץ · עייפות",   weight: 15, Icon: Brain,      color: "text-violet-400",  bar: "bg-violet-500" },
] as const;

const FACTOR_LABELS: Record<string, string> = {
  HEAVY_RAIN: "🌧 גשם כבד", EXTREME_HEAT: "🌡 חום קיצוני", HIGH_ALTITUDE: "⛰ גובה רב",
  HOME_KEY_INJURY: "🩹 פציעה — בית", AWAY_KEY_INJURY: "🩹 פציעה — אורחים",
  STRICT_REFEREE: "🟨 שופט קשוח", ELIMINATION_PRESSURE: "⚡ לחץ הכרעה", LONG_TRAVEL: "✈️ נסיעה ארוכה",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

function confColor(c: number) {
  return c >= 70 ? "text-emerald-400" : c >= 50 ? "text-amber-400" : "text-rose-400";
}

/* ── Plain-language factor summary (derived from real prediction data) ───── */
function deriveFactors(p: Prediction, homeTeam: string, awayTeam: string) {
  const factorSet = new Set(p.key_factors.map((f) => f.factor));
  const side = (m: ModuleProbs) =>
    m.home - m.away > 0.06 ? `יתרון ל${homeTeam}` :
    m.away - m.home > 0.06 ? `יתרון ל${awayTeam}` :
    "מאוזן";

  // 1. xG trend — from the stats module
  const s = p.by_module.stats;
  const xgDiff = (s.home - s.away) * 100;
  const xgTrend = {
    label: "מגמת xG משוקלל",
    value: `${side(s)} (${xgDiff >= 0 ? "+" : ""}${xgDiff.toFixed(0)}%)`,
    tone: xgDiff > 6 ? "text-emerald-400" : xgDiff < -6 ? "text-rose-400" : "text-slate-300",
  };

  // 2. injuries — key_factors first, fallback to human module
  const homeInj = factorSet.has("HOME_KEY_INJURY");
  const awayInj = factorSet.has("AWAY_KEY_INJURY");
  const injuries = {
    label: "פציעות והרחקות",
    value: homeInj && awayInj ? "פציעות בשתי הקבוצות"
      : homeInj ? `פציעה מרכזית — ${homeTeam}`
      : awayInj ? `פציעה מרכזית — ${awayTeam}`
      : "סגל מלא · ללא נפקדים",
    tone: homeInj || awayInj ? "text-amber-400" : "text-emerald-400",
  };

  // 3. weather/environment — key_factors first
  const wx =
    factorSet.has("HEAVY_RAIN") ? { t: "גשם כבד צפוי", c: "text-sky-400" } :
    factorSet.has("EXTREME_HEAT") ? { t: "חום קיצוני", c: "text-amber-400" } :
    factorSet.has("HIGH_ALTITUDE") ? { t: "גובה רב מעל פני הים", c: "text-violet-400" } :
    { t: "תנאים אידיאליים · ללא משקעים", c: "text-emerald-400" };
  const weather = { label: "משתני סביבה ומזג אוויר", value: wx.t, tone: wx.c };

  // 4. Poisson / Monte Carlo convergence
  const mc = p.monte_carlo;
  const mcWinner = (["home", "draw", "away"] as const).reduce((a, b) => (mc[b] > mc[a] ? b : a), "home");
  const mcLabel = mcWinner === "home" ? `יתרון ל${homeTeam}` : mcWinner === "away" ? `יתרון ל${awayTeam}` : "נטייה לתיקו";
  const poisson = {
    label: "התפלגות פואסון · Monte Carlo",
    value: `${mcLabel} (${pct(mc[mcWinner])})`,
    tone: "text-slate-300",
  };

  return [xgTrend, injuries, weather, poisson];
}

/* ── Component ───────────────────────────────────────────────────────────── */
export default function AlgorithmBreakdownModal({ open, onClose, homeTeam, awayTeam, prediction }: Props) {
  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const { by_module, confidence, monte_carlo, key_factors, final } = prediction;
  const factorSummary = deriveFactors(prediction, homeTeam, awayTeam);

  return (
    <div
      dir="rtl"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-[fadeIn_.15s_ease]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0F1318] shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/8 bg-[#0F1318]/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-extrabold text-white">איך חושב האלגוריתם?</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 transition hover:bg-white/5 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Match + confidence */}
          <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3">
            <div className="text-[13px] font-bold text-white">
              {homeTeam} <span className="text-slate-500">נגד</span> {awayTeam}
            </div>
            <div className="flex items-center gap-1.5">
              <Target className={`h-4 w-4 ${confColor(confidence)}`} />
              <span className={`text-lg font-black ${confColor(confidence)}`}>{confidence}%</span>
              <span className="text-[10px] text-slate-500">ביטחון</span>
            </div>
          </div>

          {/* Plain-language factor summary */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-400/80">
              <Activity className="h-3.5 w-3.5" /> שקלול The Winning Method
            </div>
            <ul className="space-y-2 text-[13px]">
              {factorSummary.map((f) => (
                <li key={f.label} className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">{f.label}</span>
                  <span className={`font-semibold ${f.tone}`}>{f.value}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-white/5 pt-2 text-center text-[10px] text-slate-600">
              נסרק בזמן אמת מתוך נתוני המשחק · עומק 360°
            </p>
          </div>

          {/* Module breakdown */}
          <div>
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <Info className="h-3.5 w-3.5" /> 4 מנועי ניתוח · משוקללים לתוצאה
            </div>
            <div className="space-y-3">
              {MODULES.map(({ key, label, sub, weight, Icon, color, bar }) => {
                const m = by_module[key as keyof typeof by_module];
                return (
                  <div key={key} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${color}`} />
                        <div>
                          <div className="text-[13px] font-bold text-white">{label}</div>
                          <div className="text-[10px] text-slate-500">{sub}</div>
                        </div>
                      </div>
                      <span className={`rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold ${color}`}>
                        {weight}% משקל
                      </span>
                    </div>
                    {/* home / draw / away split */}
                    <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
                      <div className="bg-emerald-500" style={{ width: pct(m.home) }} />
                      <div className="bg-slate-600" style={{ width: pct(m.draw) }} />
                      <div className="bg-rose-500" style={{ width: pct(m.away) }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px]">
                      <span className="text-emerald-400">בית {pct(m.home)}</span>
                      <span className="text-slate-500">תיקו {pct(m.draw)}</span>
                      <span className="text-rose-400">אורחים {pct(m.away)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key factors */}
          {key_factors.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <TrendingUp className="h-3.5 w-3.5" /> גורמים מכריעים שזוהו
              </div>
              <div className="flex flex-wrap gap-2">
                {key_factors.map((f) => (
                  <span
                    key={f.factor}
                    title={f.detail}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      f.impact === "CRITICAL"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                        : f.impact === "HIGH"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                        : "border-slate-500/30 bg-slate-500/10 text-slate-400"
                    }`}
                  >
                    {FACTOR_LABELS[f.factor] ?? f.factor}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Monte Carlo + final */}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
            <div>
              <Dice5 className="mx-auto mb-1 h-4 w-4 text-slate-400" />
              <div className="text-sm font-black text-white">{monte_carlo.simulations.toLocaleString("he-IL")}</div>
              <div className="text-[9px] text-slate-500">סימולציות</div>
            </div>
            <div>
              <Target className={`mx-auto mb-1 h-4 w-4 ${confColor(confidence)}`} />
              <div className={`text-sm font-black ${confColor(confidence)}`}>{confidence}%</div>
              <div className="text-[9px] text-slate-500">ביטחון סופי</div>
            </div>
            <div>
              <TrendingUp className="mx-auto mb-1 h-4 w-4 text-emerald-400" />
              <div className="text-sm font-black text-white">{pct(Math.max(final.home, final.draw, final.away))}</div>
              <div className="text-[9px] text-slate-500">תוצאה מובילה</div>
            </div>
          </div>

          <p className="text-center text-[10px] leading-relaxed text-slate-600">
            הביטחון מחושב מדומיננטיות התוצאה, הפער בין האפשרויות, התכנסות ה-Monte Carlo ועושר הנתונים האמיתיים.
            למטרות מחקר בלבד — אין לראות בכך המלצה פיננסית.
          </p>
        </div>
      </div>

      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  );
}
