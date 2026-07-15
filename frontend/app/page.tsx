import MatchCard from "@/components/MatchCard";
import DashboardTabs from "@/components/DashboardTabs";
import TelegramCTABanner from "@/components/TelegramCTABanner";
import WorldCupTicker from "@/components/WorldCupTicker";
import { getEnhancedMatches } from "@/lib/enhancedMatches";
import { requireApprovedUser, backendAuthHeaders } from "@/lib/session";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

async function getLiveMatches() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);
    const res = await fetch(`${API_URL}/api/live/matches?limit=8`, {
      cache: "no-store",
      signal: controller.signal,
      headers: await backendAuthHeaders(),
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === "success" && data.count > 0) {
      const matches = await getEnhancedMatches(data.matches);
      return { matches, mode: data.display_mode ?? "live", isReal: true };
    }
    return { matches: [], mode: "none", isReal: false };
  } catch (e) {
    console.error("getLiveMatches error:", e);
    return { matches: [], mode: "none", isReal: false };
  }
}

async function getWorldCupMatches() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);
    const res = await fetch(`${API_URL}/api/live/world-cup?days=7&limit=30`, {
      cache: "no-store",
      signal: controller.signal,
      headers: await backendAuthHeaders(),
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status !== "success") return [];
    // hide matches without bookmaker odds — not actionable (same rule as /world-cup page)
    return (data.matches ?? []).filter((m: any) => m.odds?.odds_home > 1);
  } catch (e) {
    console.error("getWorldCupMatches error:", e);
    return [];
  }
}

async function getDemoData() {
  try {
    const res = await fetch(`${API_URL}/api/matches/demo`, {
      cache: "no-store",
      headers: await backendAuthHeaders(),
    });
    return await res.json();
  } catch { return null; }
}

async function getTrackStats() {
  try {
    const res = await fetch(`${API_URL}/api/live/track-record?limit=100`, {
      cache: "no-store",
      headers: await backendAuthHeaders(),
    });
    const data = await res.json();
    return {
      summary:   data.summary   ?? null,
      byLeague:  data.by_league ?? [],
    };
  } catch { return { summary: null, byLeague: [] }; }
}

export default async function Home() {
  await requireApprovedUser();

  const [liveResult, demo, trackStats, wcMatches] = await Promise.all([
    getLiveMatches(), getDemoData(), getTrackStats(), getWorldCupMatches()
  ]);
  const liveMatches = liveResult.matches;
  const displayMode = liveResult.mode;
  const isRealData  = liveResult.isReal;
  const hasLive     = liveMatches.length > 0;
  const byLeague    = trackStats.byLeague as { league: string; total: number; correct: number; rate: number }[];
  const summary     = trackStats.summary;

  const pageTitle =
    displayMode === "live"      ? "משחקים חיים עכשיו 🔴" :
    displayMode === "scheduled" ? "סיגנלים חמים היום 🔥" :
                                  "ניתוחים אחרונים 📊";

  const valueBetCount = hasLive
    ? liveMatches.filter((m: any) =>
        m.value_bets && Object.values(m.value_bets as Record<string, any>).some((v: any) => v?.is_value_bet)
      ).length
    : (demo?.value_bets && Object.values(demo.value_bets as Record<string, any>).some((v: any) => v?.is_value_bet) ? 1 : 0);

  const lockCount = hasLive
    ? liveMatches.filter((m: any) => m.consensus?.type === "LOCK").length
    : (demo?.consensus?.type === "LOCK" ? 1 : 0);

  const matchCount = hasLive ? liveMatches.length : (demo ? 1 : 0);

  const modeLabel =
    displayMode === "live"      ? "בזמן אמת" :
    displayMode === "scheduled" ? "להיום" :
    hasLive                     ? "7 ימים אחרונים" : "Demo";

  // סטטיסטיקות — מה-DB אם זמין, אחרת ברירות מחדל
  const accuracy  = summary?.total > 0 ? `${summary.accuracy}%` : "—";
  const accSub    = summary?.total > 0 ? `${summary.correct}/${summary.total} ניבויים` : "מצטבר נתונים";

  const stats = [
    { label: "דיוק האלגוריתם",    value: accuracy,                                          sub: accSub,                    color: "text-emerald-400" },
    { label: "הימורי ערך שנמצאו", value: valueBetCount > 0 ? `${valueBetCount} ⚡` : "0",   sub: "מהמשחקים הנוכחיים",       color: "text-amber-400"  },
    { label: "משחקים בניתוח",      value: matchCount.toString(),                              sub: modeLabel,                 color: "text-blue-400"   },
    { label: "נעילות קונסנזוס",   value: lockCount > 0 ? lockCount.toString() : "0",        sub: "הסכמה מלאה במשחקים הנוכחיים", color: "text-purple-400" },
  ];

  const leagueAccuracy = byLeague ?? [];

  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }}>

      {/* Dynamic ticker — World Cup picks first, then value bets */}
      {hasLive && <WorldCupTicker matches={liveMatches} />}

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px", paddingTop: hasLive ? 80 : 40 }}>

        {/* Hero */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 36, fontWeight: 900, color: "white", marginBottom: 8 }}>
            {pageTitle}
          </h1>
          <p style={{ color: "#64748b", fontSize: 15 }}>
            ניתוח 360 מעלות — xG · מזג אוויר · שופט · פציעות · פסיכולוגיה · קונסנזוס מומחים
          </p>
        </div>

        {/* Stats Bar */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 40,
        }}>
          {stats.map((s) => (
            <div key={s.label} style={{
              background: "#0F1318",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
              padding: "20px 24px",
            }}>
              <div className={s.color} style={{ fontSize: 28, fontWeight: 900, direction: "ltr", textAlign: "right" }}>
                {s.value}
              </div>
              <div style={{ color: "white", fontSize: 13, marginTop: 4 }}>{s.label}</div>
              <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Match Cards Grid — league filter */}
        <div>
          {hasLive ? (
            // ✅ משחקים אמיתיים מה-API — top-level tabs: All / Live / World Cup
            <DashboardTabs
              matches={liveMatches}
              wcMatches={wcMatches}
              leagueAccuracy={leagueAccuracy}
              globalAccuracy={summary?.accuracy ?? null}
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(560px, 1fr))", gap: 24 }}>
              {/* הודעת מצב */}
              {!isRealData && (
                <div style={{
                  gridColumn: "1 / -1",
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.2)",
                  borderRadius: 12, padding: "12px 20px",
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 4,
                }}>
                  <span style={{ fontSize: 20 }}>⚠️</span>
                  <div>
                    <div style={{ color: "#f59e0b", fontWeight: 700, fontSize: 13 }}>
                      אין משחקים זמינים כרגע
                    </div>
                    <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                      הדף מתרענן אוטומטית · מוצג Demo · המונדיאל 2026 מתחיל 11/6
                    </div>
                  </div>
                </div>
              )}
              {demo && (
                <MatchCard
                  homeTeam={demo.prediction.home_team}
                  awayTeam={demo.prediction.away_team}
                  league="גביע העולם FIFA 2026 — Demo"
                  prediction={demo.prediction}
                  value_bets={demo.value_bets}
                  consensus={demo.consensus}
                  matchId="WC2026-demo"
                />
              )}
            </div>
          )}
        </div>

        {/* Telegram community CTA */}
        <div style={{ marginTop: 48 }}>
          <TelegramCTABanner />
        </div>

        {/* Footer */}
        <div style={{ marginTop: 32, textAlign: "center", color: "#374151", fontSize: 12 }}>
          ANALYST365 — למטרות מחקר בלבד. אין לראות בתכנים המלצה פיננסית.
        </div>
      </main>
    </div>
  );
}
