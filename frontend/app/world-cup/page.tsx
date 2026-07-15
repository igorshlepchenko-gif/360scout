"use client";

import { useState, useEffect, useCallback } from "react";
import { Trophy, RefreshCw, Radio, CalendarDays, CheckCircle2 } from "lucide-react";
import MatchCard from "@/components/MatchCard";
import { useRequireAuth } from "@/hooks/useRequireAuth";

const API = "/api/backend";

interface WCMatch {
  fixture_id: number;
  home_team: string;
  away_team: string;
  home_logo?: string;
  away_logo?: string;
  league: string;
  league_logo?: string;
  match_date: string;
  _status?: string;
  elapsed?: number | null;
  score?: { home: number | null; away: number | null } | null;
  prediction: any;
  value_bets: any;
  consensus: any;
  odds?: any;
  weather?: any;
  xg?: any;
  goals_signal?: any;
  ou_edge?: any;
  handicap_signal?: any;
  lineups?: any;
}

export default function WorldCupPage() {
  useRequireAuth();
  const [matches, setMatches]   = useState<WCMatch[]>([]);
  const [loading, setLoading]   = useState(true);
  const [liveCount, setLiveCount] = useState(0);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/live/world-cup?days=7&limit=30`, { cache: "no-store" });
      const d = await r.json();
      // dedupe — ליתר ביטחון
      const seen = new Set<number>();
      const list = (d.matches ?? []).filter((m: WCMatch) => {
        if (seen.has(m.fixture_id)) return false;
        seen.add(m.fixture_id);
        // hide matches without bookmaker odds — not actionable
        if (!m.odds || !(m.odds.odds_home > 1)) return false;
        return true;
      });
      setMatches(list);
      setLiveCount(d.live_count ?? list.filter((m: WCMatch) => m._status === "live").length);
    } catch { setMatches([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  const live      = matches.filter(m => m._status === "live");
  const upcoming  = matches.filter(m => m._status === "scheduled");
  const finished  = matches.filter(m => m._status === "finished");

  const Section = ({ title, icon, items }: { title: string; icon: React.ReactNode; items: WCMatch[] }) => {
    if (items.length === 0) return null;
    return (
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          {icon}
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "white" }}>{title}</h2>
          <span style={{ color: "#475569", fontSize: 12 }}>({items.length})</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(560px, 1fr))", gap: 24 }}>
          {items.map(m => (
            <MatchCard
              key={m.fixture_id}
              homeTeam={m.home_team}
              awayTeam={m.away_team}
              homeLogo={m.home_logo}
              awayLogo={m.away_logo}
              league={m.league}
              leagueLogo={m.league_logo}
              matchDate={m.match_date}
              isLive={m._status === "live"}
              prediction={m.prediction}
              value_bets={m.value_bets}
              consensus={m.consensus}
              fixtureId={m.fixture_id}
              matchId={String(m.fixture_id)}
              odds={m.odds}
              weather={m.weather}
              xg={m.xg}
              goals_signal={m.goals_signal}
              ou_edge={m.ou_edge}
              handicap_signal={m.handicap_signal}
              lineups={m.lineups}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }} dir="rtl">
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px" }}>

        {/* Hero */}
        <div style={{
          marginBottom: 36,
          background: "linear-gradient(135deg, rgba(234,179,8,0.10), rgba(251,191,36,0.04))",
          border: "1px solid rgba(234,179,8,0.25)",
          borderRadius: 20, padding: "28px 32px",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: "rgba(234,179,8,0.15)", border: "1px solid rgba(234,179,8,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Trophy size={28} color="#fbbf24" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "white" }}>
                מונדיאל 2026 <span style={{ color: "#fbbf24" }}>🏆</span>
              </h1>
              <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 14 }}>
                כל משחקי גביע העולם — חיזויי 360°, Value Bets ולוח 7 הימים הקרובים
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {liveCount > 0 && (
              <span style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
                color: "#ef4444", borderRadius: 99, padding: "6px 14px",
                fontSize: 13, fontWeight: 800,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite" }} />
                {liveCount} חיים עכשיו
              </span>
            )}
            <button onClick={fetchMatches} disabled={loading} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.3)",
              color: "#fbbf24", borderRadius: 10, padding: "8px 16px",
              fontSize: 13, fontWeight: 700, cursor: loading ? "wait" : "pointer",
            }}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> רענן
            </button>
          </div>
        </div>

        {/* Content */}
        {loading && matches.length === 0 ? (
          <div style={{ textAlign: "center", color: "#475569", padding: "80px 0", fontSize: 14 }}>
            🏆 טוען את משחקי המונדיאל...
          </div>
        ) : matches.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "60px 0",
            background: "#0F1318", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
            <div style={{ color: "#94a3b8", fontSize: 15 }}>אין משחקי מונדיאל בטווח 7 הימים הקרובים</div>
            <div style={{ color: "#475569", fontSize: 13, marginTop: 6 }}>הלוח מתעדכן אוטומטית</div>
          </div>
        ) : (
          <>
            <Section title="חיים עכשיו"        icon={<Radio size={18} color="#ef4444" />}        items={live} />
            <Section title="המשחקים הקרובים"   icon={<CalendarDays size={18} color="#fbbf24" />} items={upcoming} />
            <Section title="הסתיימו"           icon={<CheckCircle2 size={18} color="#475569" />} items={finished} />
          </>
        )}

        <div style={{ marginTop: 24, textAlign: "center", color: "#374151", fontSize: 12 }}>
          ANALYST365 — למטרות מחקר בלבד. אין לראות בתכנים המלצה פיננסית.
        </div>
      </main>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
}
