import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Winning Method — Analyst365",
  description: "מתודולוגיית ניתוח 360 מעלות: xG משוקלל, הסתברויות, יחס הוגן וזיהוי Value Bet.",
};

// ── Demo row for the explanation table ──────────────────────────────────────
const DEMO_ROWS = [
  {
    param:    "⚽ xG משוקלל",
    home:     "1.85",
    draw:     "—",
    away:     "1.12",
    rowStyle: "default" as const,
    note:     "שערים צפויים לפי נתוני xG אמיתיים מה-API",
  },
  {
    param:    "📊 הסתברות המודל",
    home:     "54.2%",
    draw:     "24.1%",
    away:     "21.7%",
    rowStyle: "prob" as const,
    note:     "פלט אלגוריתם Monte-Carlo (10,000 סימולציות)",
  },
  {
    param:    "⚖️ יחס הוגן (Fair Odds)",
    home:     "1.84",
    draw:     "4.15",
    away:     "4.61",
    rowStyle: "default" as const,
    note:     "1 ÷ הסתברות — היחס ב'עולם הוגן' ללא מרווח",
  },
  {
    param:    "💰 יחס השוק (Bookmaker)",
    home:     "1.65",
    draw:     "3.80",
    away:     "5.50",
    rowStyle: "default" as const,
    note:     "Pinnacle / Bet365 בזמן אמת מה-API",
  },
  {
    param:    "⚡ ערך (Edge)",
    home:     "✅ +8.3%",
    draw:     "—",
    away:     "—",
    rowStyle: "value" as const,
    note:     "Edge > 5% → Value Bet · סיגנל נשלח לטלגרם",
  },
];

const MODULES = [
  { icon: "📈", title: "סטטיסטיקות וxG",          desc: "נתוני שערים צפויים, סטייסטיקות עונה, קצב חצי-מגרש" },
  { icon: "🌦️", title: "מזג אוויר",                desc: "גשם, חום קיצוני, רוח — תנאים משפיעים על הניבוי" },
  { icon: "🟨", title: "שופט ולחץ",                desc: "דפוס כרטיסים, לחץ אליפות/הורדה, עייפות קבוצתית" },
  { icon: "🩹", title: "פציעות והרכב",             desc: "שחקן מרכזי חסר → הורדת ביטחון אוטומטית" },
  { icon: "🤝", title: "קונסנזוס אנליסטים",         desc: "הצלבת אלגוריתם עם אנליסטים אנושיים → LOCK" },
  { icon: "⚡", title: "Value Bet Detection",       desc: "Edge > 5% מול Pinnacle → התראה מיידית לטלגרם" },
];

// ── Styles ───────────────────────────────────────────────────────────────────
const TH: React.CSSProperties = {
  padding: "11px 14px", fontSize: 11, fontWeight: 700,
  color: "#64748b", textAlign: "center", whiteSpace: "nowrap",
  background: "rgba(15,23,42,0.7)", borderBottom: "1px solid #334155",
};
const TD_BASE: React.CSSProperties = {
  padding: "13px 14px", fontSize: 13, textAlign: "center",
  fontFamily: "monospace", borderBottom: "1px solid #1e293b",
};
const TD_LABEL: React.CSSProperties = {
  padding: "13px 16px", fontSize: 12, fontWeight: 700,
  color: "#94a3b8", textAlign: "right", borderBottom: "1px solid #1e293b",
  whiteSpace: "nowrap",
};

function rowBg(style: "default" | "prob" | "value") {
  if (style === "prob")  return "rgba(56,189,248,0.06)";
  if (style === "value") return "rgba(74,222,128,0.07)";
  return "transparent";
}
function cellColor(style: "default" | "prob" | "value", isValue: boolean) {
  if (style === "prob")              return "#38bdf8";
  if (style === "value" && isValue)  return "#4ade80";
  return "#cbd5e1";
}

export default function WinningMethodPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#121824", color: "white" }}>
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" }}>

        {/* ── Hero ── */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{
            display: "inline-block",
            background: "rgba(56,189,248,0.1)",
            border: "1px solid rgba(56,189,248,0.3)",
            borderRadius: 8, padding: "4px 14px", fontSize: 11,
            color: "#38bdf8", fontWeight: 700, marginBottom: 16,
          }}>
            ANALYST365 · מתודולוגיה
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 900, margin: "0 0 12px" }}>
            The Winning Method
          </h1>
          <p style={{ color: "#94a3b8", fontSize: 15, maxWidth: 560, margin: "0 auto" }}>
            ניתוח 360 מעלות — מודל המשלב xG, מזג אוויר, שופט, פציעות וקונסנזוס אנליסטים
            לזיהוי Value Bet בזמן אמת.
          </p>
        </div>

        {/* ── Comparison Table ── */}
        <div style={{
          background: "#1e2640",
          border: "1px solid #334155",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          marginBottom: 48,
        }}>
          {/* Table header */}
          <div style={{
            background: "linear-gradient(135deg, #1e293b, #0f172a)",
            padding: "20px 24px",
            borderBottom: "2px solid #38bdf8",
            textAlign: "center",
          }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              📊 דוגמה: ניתוח משחק בזמן אמת
            </h2>
            <span style={{ color: "#94a3b8", fontSize: 12, display: "block", marginTop: 6 }}>
              ברזיל (בית) · צרפת (אורחים) · יחסי Pinnacle · מונדיאל 2026
            </span>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: "right" }}>פרמטר</th>
                  <th style={TH}>1 — ברזיל (בית)</th>
                  <th style={TH}>X — תיקו</th>
                  <th style={TH}>2 — צרפת (אורחים)</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_ROWS.map((row, i) => {
                  const isLast  = i === DEMO_ROWS.length - 1;
                  const tdStyle: React.CSSProperties = {
                    ...TD_BASE,
                    background: rowBg(row.rowStyle),
                    borderBottom: isLast ? "none" : "1px solid #1e293b",
                    fontWeight: row.rowStyle !== "default" ? 700 : 400,
                    fontSize: row.rowStyle === "prob" ? 15 : 13,
                  };
                  return (
                    <tr key={row.param}>
                      <td style={{
                        ...TD_LABEL,
                        background: rowBg(row.rowStyle),
                        color: row.rowStyle === "prob" ? "#38bdf8" : row.rowStyle === "value" ? "#4ade80" : "#94a3b8",
                        borderBottom: isLast ? "none" : "1px solid #1e293b",
                      }}>
                        {row.param}
                        <div style={{ fontSize: 10, color: "#475569", fontWeight: 400, marginTop: 2 }}>
                          {row.note}
                        </div>
                      </td>
                      {[row.home, row.draw, row.away].map((val, ci) => (
                        <td key={ci} style={{
                          ...tdStyle,
                          color: cellColor(row.rowStyle, val.startsWith("✅")),
                        }}>
                          {val}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Module grid ── */}
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 20 }}>
          🔬 מודולי הניתוח
        </h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 16,
          marginBottom: 48,
        }}>
          {MODULES.map(m => (
            <div key={m.title} style={{
              background: "#1e2640",
              border: "1px solid #334155",
              borderRadius: 10,
              padding: "18px 20px",
            }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{m.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: "white", marginBottom: 4 }}>{m.title}</div>
              <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>{m.desc}</div>
            </div>
          ))}
        </div>

        {/* ── CTA ── */}
        <div style={{
          background: "linear-gradient(135deg, rgba(56,189,248,0.08), rgba(99,102,241,0.06))",
          border: "1px solid rgba(56,189,248,0.2)",
          borderRadius: 14, padding: "28px 32px", textAlign: "center",
        }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>📨</div>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800 }}>
            קבלו Value Bet ישירות לטלגרם
          </h3>
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 20px" }}>
            כל סיגנל חזק שהאלגוריתם מזהה נשלח אוטומטית לערוץ — בלי לרענן, בלי לפספס.
          </p>
          <a
            href="https://t.me/Malmilyan"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#38bdf8", color: "black",
              fontWeight: 800, fontSize: 14,
              padding: "11px 28px", borderRadius: 8,
              textDecoration: "none",
            }}
          >
            הצטרף לערוץ ←
          </a>
        </div>

      </main>
    </div>
  );
}
