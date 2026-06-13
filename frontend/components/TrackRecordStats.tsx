interface StatsData {
  homeWins:  { success: number; total: number };
  draws:     { success: number; total: number };
  awayWins:  { success: number; total: number };
  valueBets: { total: number; won: number; avgOdds: number };
}

interface Props {
  statsData?: StatsData;
}

const calcPct = (success: number, total: number) =>
  total > 0 ? Math.round((success / total) * 100) : 0;

export default function TrackRecordStats({ statsData }: Props) {
  if (!statsData) return null;
  const data = statsData;

  const homePct = calcPct(data.homeWins.success, data.homeWins.total);
  const drawPct = calcPct(data.draws.success,    data.draws.total);
  const awayPct = calcPct(data.awayWins.success, data.awayWins.total);

  // ROI = ((Total Payout − Total Stake) / Total Stake) × 100
  const { total: vbTotal, won: vbWon, avgOdds } = data.valueBets;
  const yieldPct    = vbTotal > 0
    ? ((vbWon * avgOdds - vbTotal) / vbTotal) * 100
    : 0;
  const valueAcc    = calcPct(vbWon, vbTotal);
  const yieldSign   = yieldPct >= 0 ? "+" : "";
  const yieldColor  = yieldPct >= 0 ? "text-emerald-400" : "text-rose-500";

  const bars = [
    { label: "ניצחון ביתי",   pct: homePct, data: data.homeWins, bar: "bg-emerald-500", txt: "text-emerald-400" },
    { label: "תיקו",          pct: drawPct, data: data.draws,    bar: "bg-amber-500",   txt: "text-amber-500"   },
    { label: "ניצחון אורחים", pct: awayPct, data: data.awayWins, bar: "bg-rose-500",    txt: "text-rose-500"    },
  ];

  return (
    <div className="w-full text-white space-y-4" dir="rtl">
      <h3 className="text-[15px] font-extrabold">🎯 פירוט לפי תוצאה</h3>

      {bars.map(b => (
        <div key={b.label} className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className={`${b.txt} font-bold`}>{b.pct}%</span>
            <span className="text-white">{b.label}</span>
          </div>

          {/*
            direction:ltr — critical fix: prevents RTL context from
            reversing the bar fill direction (right→left instead of left→right).
            width is bound directly to the calculated success percentage.
          */}
          <div
            className="w-full h-2.5 rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.05)", direction: "ltr" }}
          >
            <div
              className={`${b.bar} h-full rounded-full opacity-80 transition-all duration-500`}
              style={{ width: `${b.pct}%` }}
            />
          </div>

          <span className="text-[10px] text-slate-600 block">
            {b.data.success} מתוך {b.data.total}
          </span>
        </div>
      ))}

      {/* Value Bet panel */}
      <div
        className="mt-2 rounded-xl p-3.5 flex justify-between items-center"
        style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}
      >
        <div>
          <span className="text-xs font-bold text-emerald-400">⚡ הימורי ערך בלבד</span>
        </div>

        <div className="text-center">
          <div className="text-white font-black text-xl">{valueAcc}%</div>
          <div className="text-[10px] text-slate-500">דיוק</div>
        </div>

        {/* Yield — computed from ROI formula, not hardcoded */}
        <div className="text-center">
          <div className={`font-black text-xl ${yieldColor}`}>
            {yieldSign}{yieldPct.toFixed(0)}%
          </div>
          <div className="text-[10px] text-slate-500">תשואה</div>
        </div>

        <div className="text-center">
          <div className="text-white font-black text-xl">{vbTotal}</div>
          <div className="text-[10px] text-slate-500">סה&quot;כ</div>
        </div>
      </div>
    </div>
  );
}
