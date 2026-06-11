"use client";

import { useState } from "react";
import { SlidersHorizontal, Search, Percent, Award } from "lucide-react";

export interface FilterState {
  searchQuery: string;
  onlyValue: boolean;
  onlyConsensus: boolean;
  leagueGroup: "ALL" | "MAJOR" | "MINOR";
  sortBy: "TIME" | "VALUE_DESC" | "CONFIDENCE_DESC";
}

interface FilterSortBarProps {
  onFilterChange: (filters: FilterState) => void;
}

export default function FilterSortBar({ onFilterChange }: FilterSortBarProps) {
  const [filters, setFilters] = useState<FilterState>({
    searchQuery: "",
    onlyValue: false,
    onlyConsensus: false,
    leagueGroup: "ALL",
    sortBy: "TIME",
  });

  const update = (patch: Partial<FilterState>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    onFilterChange(next);
  };

  const grpActive = (key: FilterState["leagueGroup"]) => filters.leagueGroup === key;

  return (
    <div
      dir="rtl"
      style={{
        background: "#0F1318",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "14px 16px",
        marginBottom: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Row 1: search + league group */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>

        {/* Free-text search */}
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute", right: 10, top: "50%",
              transform: "translateY(-50%)", color: "#475569", pointerEvents: "none",
            }}
          />
          <input
            type="text"
            placeholder="חפש קבוצה או ליגה..."
            value={filters.searchQuery}
            onChange={(e) => update({ searchQuery: e.target.value })}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "7px 32px 7px 10px",
              fontSize: 12, color: "#e2e8f0", outline: "none",
            }}
          />
        </div>

        {/* League group segmented control */}
        <div style={{
          display: "flex",
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: 3,
          gap: 2,
        }}>
          {(
            [
              { key: "ALL",   label: "כל הליגות",       color: "#e2e8f0" },
              { key: "MAJOR", label: "🏆 ליגות בכירות", color: "#60a5fa" },
              { key: "MINOR", label: "🎯 Value ציידי",   color: "#fbbf24" },
            ] as const
          ).map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => update({ leagueGroup: key })}
              style={{
                flex: 1,
                padding: "6px 4px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: grpActive(key) ? 700 : 500,
                transition: "all 0.15s",
                background: grpActive(key) ? "rgba(255,255,255,0.07)" : "transparent",
                color: grpActive(key) ? color : "#64748b",
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: toggles + sort */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        paddingTop: 10,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        flexWrap: "wrap",
      }}>

        {/* Quick toggles */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { key: "onlyValue" as const,     icon: <Percent size={13} />, label: "רק משחקים עם Value 🔥", accent: "#10b981" },
            { key: "onlyConsensus" as const, icon: <Award   size={13} />, label: "נעילות קונסנזוס בלבד ⭐", accent: "#3b82f6" },
          ].map(({ key, icon, label, accent }) => {
            const on = filters[key] as boolean;
            return (
              <button
                key={key}
                onClick={() => update({ [key]: !on })}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 99, fontSize: 12,
                  fontWeight: on ? 700 : 500, cursor: "pointer",
                  transition: "all 0.15s",
                  border: on ? `1px solid ${accent}40` : "1px solid rgba(255,255,255,0.1)",
                  background: on ? `${accent}14` : "rgba(255,255,255,0.03)",
                  color: on ? accent : "#64748b",
                }}
              >
                {icon}
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Sort dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SlidersHorizontal size={13} style={{ color: "#475569" }} />
          <span style={{ color: "#475569", fontSize: 12 }}>מיין לפי:</span>
          <select
            value={filters.sortBy}
            onChange={(e) => update({ sortBy: e.target.value as FilterState["sortBy"] })}
            style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8, padding: "5px 10px",
              fontSize: 12, color: "#e2e8f0",
              outline: "none", cursor: "pointer",
            }}
          >
            <option value="TIME">🕒 שעת משחק</option>
            <option value="VALUE_DESC">📈 Value הגבוה ביותר</option>
            <option value="CONFIDENCE_DESC">🤖 ביטחון אלגוריתם</option>
          </select>
        </div>
      </div>
    </div>
  );
}
