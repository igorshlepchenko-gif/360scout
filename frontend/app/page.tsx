import MatchCard from "@/components/MatchCard";
import TelegramCTABanner from "@/components/TelegramCTABanner";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

async function getLiveMatches() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28000);
    const res = await fetch(`${API_URL}/api/live/matches?limit=8`, {
      next: { revalidate: 120 },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === "success" && data.count > 0) {
      return { matches: data.matches, mode: data.display_mode ?? "live", isReal: true };
    }
    return { matches: [], mode: "none", isReal: false };
  } catch (e) {
    console.error("getLiveMatches error:", e);
    return { matches: [], mode: "none", isReal: false };
  }
}

async function getDemoData() {
  try {
    const res = await fetch(`${API_URL}/api/matches/demo`, { cache: "no-store" });
    return await res.json();
  } catch { return null; }
}

async function getTrackStats() {
  try {
    const res = await fetch(`${API_URL}/api/live/track-record?limit=100`, {
      next: { revalidate: 300 },
    });
    const data = await res.json();
    return data.summary ?? null;
  } catch { return null; }
}

export default async function Home() {
  const [liveResult, demo, trackStats] = await Promise.all([
    getLiveMatches(), getDemoData(), getTrackStats()
  ]);
  const liveMatches = liveResult.matches;
  const displayMode = liveResult.mode;
  const isRealData  = liveResult.isReal;
  const hasLive     = liveMatches.length > 0;

  const pageTitle =
    displayMode === "live"      ? "משחקים חיים עכשיו 🔴" :
    displayMode === "scheduled" ? "סיגנלים חמים היום 🔥" :
                                  "ניתוחים אחרונים 📊";

  const valueBetCount = liveMatches.filter((m: any) =>
    m.value_bets && Object.values(m.value_bets as Record<string, any>).some((v: any) => v?.is_value_bet)
  ).length;

  const lockCount = liveMatches.filter((m: any) =>
    m.consensus?.type === "LOCK"
  ).length;

  const modeLabel =
    displayMode === "live"      ? "בזמן אמת" :
    displayMode === "scheduled" ? "להיום" :
    hasLive                     ? "7 ימים אחרונים" : "Demo";

  // סטטיסטיקות — מה-DB אם זמין, אחרת ברירות מחדל
  const accuracy  = trackStats?.total > 0 ? `${trackStats.accuracy}%` : "—";
  const accSub    = trackStats?.total > 0 ? `${trackStats.correct}/${trackStats.total} ניבויים` : "מצטבר נתונים";

  const stats = [
    { label: "דיוק האלגוריתם",    value: accuracy,                                          sub: accSub,                    color: "text-emerald-400" },
    { label: "הימורי ערך שנמצאו", value: valueBetCount > 0 ? `${valueBetCount} ⚡` : "0",   sub: "מהמשחקים הנוכחיים",       color: "text-amber-400"  },
    { label: "משחקים בניתוח",      value: liveMatches.length.toString(),                     sub: modeLabel,                 color: "text-blue-400"   },
    { label: "נעילות קונסנזוס",   value: lockCount > 0 ? lockCount.toString() : "0",        sub: "הסכמה מלאה במשחקים הנוכחיים", color: "text-purple-400" },
  ];

  const navItems = [
    { label: "סיגנלים חמים",      href: "/",             active: true  },
    { label: "כל המשחקים",        href: "/matches",      active: false },
    { label: "ביצועים היסטוריים", href: "/track-record", active: false },
    { label: "אנליסטים",          href: "/analysts",     active: false },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }}>

      {/* Navbar */}
      <nav style={{
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        background: "rgba(11,14,20,0.95)",
        backdropFilter: "blur(12px)",
        zIndex: 50,
      }}>
        {/* Logo */}
        <a href="/" style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-0.5px", direction: "ltr", textDecoration: "none" }}>
          <span style={{ color: "#10b981" }}>ANALYST</span>
          <span style={{ color: "white" }}>365</span>
        </a>

        {/* Nav links */}
        <div style={{ display: "flex", gap: 28 }}>
          {navItems.map((item) => (
            <a key={item.label} href={item.href} style={{
              color: item.active ? "white" : "#64748b",
              fontSize: 14,
              fontWeight: item.active ? 600 : 400,
              textDecoration: "none",
              transition: "color 0.2s",
            }}>
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px" }}>

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

        {/* Match Cards Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(560px, 1fr))",
          gap: 24,
        }}>
          {hasLive ? (
            // ✅ משחקים אמיתיים מה-API
            liveMatches.map((m: any) => (
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
              />
            ))
          ) : (
            <>
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
                />
              )}
            </>
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
