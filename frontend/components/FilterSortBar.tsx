"use client";

import { Lock, Zap, Trophy, LayoutGrid, SlidersHorizontal, Target } from "lucide-react";

export type MatchFilter = "all" | "value" | "lock" | "high_conf" | "major";
export type MatchSort   = "confidence" | "date" | "edge";

interface Counts {
  all: number;
  value: number;
  lock: number;
  high_conf: number;
  major: number;
}

interface Props {
  filter: MatchFilter;
  sort: MatchSort;
  counts: Counts;
  onFilter: (f: MatchFilter) => void;
  onSort: (s: MatchSort) => void;
}

const FILTERS: { key: MatchFilter; label: string; Icon: typeof LayoutGrid; active: string }[] = [
  { key: "all",       label: "הכל",          Icon: LayoutGrid, active: "border-white/30 bg-white/10 text-white" },
  { key: "high_conf", label: "ביטחון גבוה",  Icon: Target,     active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" },
  { key: "value",     label: "Value Bets",   Icon: Zap,        active: "border-amber-500/40 bg-amber-500/15 text-amber-400" },
  { key: "lock",      label: "נעילות",       Icon: Lock,       active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" },
  { key: "major",     label: "ליגות בכירות", Icon: Trophy,     active: "border-violet-500/40 bg-violet-500/15 text-violet-400" },
];

const SORTS: { key: MatchSort; label: string }[] = [
  { key: "confidence", label: "אחוז ביטחון" },
  { key: "edge",       label: "Edge % (יתרון)" },
  { key: "date",       label: "זמן בעיטה" },
];

export default function FilterSortBar({ filter, sort, counts, onFilter, onSort }: Props) {
  return (
    <div dir="rtl" className="mb-6 flex flex-wrap items-center gap-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(({ key, label, Icon, active }) => {
          const isOn = filter === key;
          return (
            <button
              key={key}
              onClick={() => onFilter(key)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                isOn ? active : "border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className={`text-[10px] ${isOn ? "opacity-90" : "text-slate-600"}`}>
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sort — compact dropdown */}
      <div className="mr-auto flex items-center gap-2">
        <span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-500">
          <SlidersHorizontal className="h-3.5 w-3.5" /> מיין לפי:
        </span>
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as MatchSort)}
          className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 outline-none transition hover:border-white/20 focus:border-indigo-500/50"
        >
          {SORTS.map(({ key, label }) => (
            <option key={key} value={key} className="bg-[#0F1318] text-slate-200">
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
