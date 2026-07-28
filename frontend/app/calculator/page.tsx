"use client";
import { useState, useEffect } from "react";
import { useRequireAuth } from "@/hooks/useRequireAuth";

// ── Pure Poisson probability ──────────────────────────────────────────────────
function poisson(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact;
}

function calcUnder25(xgH: number, xgA: number): number {
  let p = 0;
  for (let h = 0; h <= 2; h++)
    for (let a = 0; a <= 2; a++)
      if (h + a <= 2) p += poisson(h, xgH) * poisson(a, xgA);
  return p;
}

// ── Shared style tokens ───────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff", borderRadius: 12,
  boxShadow: "0 4px 10px rgba(0,0,0,0.07)",
  padding: 22, border: "1px solid #e2e8f0",
};
const cardTitleStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "#0f172a",
  margin: "0 0 14px", paddingBottom: 8, borderBottom: "2px solid #f1f5f9",
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1",
  borderRadius: 6, boxSizing: "border-box", fontSize: 13,
  background: "#fff", color: "#334155",
};
// numeric-only variant — IBM Plex Mono for genuine data entry (not the Hebrew-label <select> fields)
const inpMono: React.CSSProperties = { ...inp, fontFamily: "var(--font-mono), monospace" };
const td: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 13 };
// numeric-only variant — for value/odds/probability cells, not the Hebrew label column
const tdMono: React.CSSProperties = { ...td, fontFamily: "var(--font-mono), monospace" };
const th: React.CSSProperties = {
  background: "#f8fafc", color: "#0f172a", padding: "10px 12px",
  fontWeight: 600, borderBottom: "2px solid #cbd5e1", fontSize: 13,
};

// ── Sub-components ────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", marginBottom: 3, fontWeight: 500, fontSize: 12, color: "#334155" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, color: "#ea580c", fontWeight: 700, margin: "14px 0 6px" }}>
      {children}
    </p>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CalculatorPage() {
  useRequireAuth();
  const [baseXgHome, setBaseXgHome] = useState("1.6");
  const [baseXgAway, setBaseXgAway] = useState("1.2");
  const [decayHome, setDecayHome] = useState("1.0");
  const [decayAway, setDecayAway] = useState("1.0");
  const [injHome, setInjHome] = useState("0");
  const [injAway, setInjAway] = useState("0");
  const [motHome, setMotHome] = useState("1.0");
  const [motAway, setMotAway] = useState("1.0");
  const [xtHome, setXtHome] = useState("0");
  const [xtAway, setXtAway] = useState("0");
  const [bookieOver, setBookieOver] = useState("1.90");
  const [bookieUnder, setBookieUnder] = useState("1.90");

  type Output = {
    xgHome: number; xgAway: number;
    overProb: number; underProb: number;
    fairOver: number; fairUnder: number;
    hasOverValue: boolean; hasUnderValue: boolean;
  };
  const [output, setOutput] = useState<Output | null>(null);

  function runModel() {
    const bH  = Math.max(0, parseFloat(baseXgHome) || 0);
    const bA  = Math.max(0, parseFloat(baseXgAway) || 0);
    const dH  = parseFloat(decayHome) || 1;
    const dA  = parseFloat(decayAway) || 1;
    const iH  = parseFloat(injHome)   || 0;
    const iA  = parseFloat(injAway)   || 0;
    const mH  = parseFloat(motHome)   || 1;
    const mA  = parseFloat(motAway)   || 1;
    const xTH = parseFloat(xtHome)    || 0;
    const xTA = parseFloat(xtAway)    || 0;
    const bO  = parseFloat(bookieOver)  || 0;
    const bU  = parseFloat(bookieUnder) || 0;

    const fXgH = Math.max(0.1, (bH * dH * (1 - iH) * mH) + xTH);
    const fXgA = Math.max(0.1, (bA * dA * (1 - iA) * mA) + xTA);

    const underPct = calcUnder25(fXgH, fXgA) * 100;
    const overPct  = 100 - underPct;
    const fO = 100 / overPct;
    const fU = 100 / underPct;

    setOutput({
      xgHome: fXgH, xgAway: fXgA,
      overProb: overPct, underProb: underPct,
      fairOver: fO, fairUnder: fU,
      hasOverValue: bO > fO, hasUnderValue: bU > fU,
    });
  }

  // Run once on mount for demo output
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runModel(); }, []);

  return (
    <div style={{ background: "#f1f5f9", minHeight: "100vh", padding: "24px 20px", direction: "rtl" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28, borderBottom: "3px solid #2563eb", paddingBottom: 14 }}>
          <h1 style={{ color: "#0f172a", margin: "0 0 6px", fontSize: 26, fontWeight: 600 }}>
            מודל חיזוי משוכלל — Analyst365
          </h1>
          <p style={{ color: "#64748b", margin: 0, fontSize: 14 }}>
            The Winning Method בשילוב פקטורים דינמיים מתקדמים
          </p>
        </div>

        {/* Two-column grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 24 }}>

          {/* ── Input Card ── */}
          <div style={card}>
            <h2 style={cardTitleStyle}>הזנת נתונים ופרמטרים משפיעים</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="xG בסיסי — קבוצת בית">
                <input style={inpMono} type="number" value={baseXgHome} step="0.1"
                  onChange={e => setBaseXgHome(e.target.value)} />
              </Field>
              <Field label="xG בסיסי — קבוצת חוץ">
                <input style={inpMono} type="number" value={baseXgAway} step="0.1"
                  onChange={e => setBaseXgAway(e.target.value)} />
              </Field>
            </div>

            <SectionLabel>1. דעיית זמן וכושר נוכחי (Form &amp; Time Decay)</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="כושר בית (5 משחקים אחרונים)">
                <select style={inp} value={decayHome} onChange={e => setDecayHome(e.target.value)}>
                  <option value="1.15">מצוין (+15% ל-xG)</option>
                  <option value="1.0">רגיל / יציב</option>
                  <option value="0.85">ירידה בכושר (-15% ל-xG)</option>
                </select>
              </Field>
              <Field label="כושר חוץ (5 משחקים אחרונים)">
                <select style={inp} value={decayAway} onChange={e => setDecayAway(e.target.value)}>
                  <option value="1.15">מצוין (+15% ל-xG)</option>
                  <option value="1.0">רגיל / יציב</option>
                  <option value="0.85">ירידה בכושר (-15% ל-xG)</option>
                </select>
              </Field>
            </div>

            <SectionLabel>2. מודל פציעות וחיסורים (Squad Impact)</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="חיסורים משמעותיים — בית">
                <select style={inp} value={injHome} onChange={e => setInjHome(e.target.value)}>
                  <option value="0">אין חיסורים קריטיים</option>
                  <option value="0.10">חיסור שחקן מפתח (10%-)</option>
                  <option value="0.20">מכת פציעות קשה (20%-)</option>
                </select>
              </Field>
              <Field label="חיסורים משמעותיים — חוץ">
                <select style={inp} value={injAway} onChange={e => setInjAway(e.target.value)}>
                  <option value="0">אין חיסורים קריטיים</option>
                  <option value="0.10">חיסור שחקן מפתח (10%-)</option>
                  <option value="0.20">מכת פציעות קשה (20%-)</option>
                </select>
              </Field>
            </div>

            <SectionLabel>3. מוטיבציה ועומס (Motivation &amp; Fatigue)</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="פקטור עומס ומוטיבציה — בית">
                <select style={inp} value={motHome} onChange={e => setMotHome(e.target.value)}>
                  <option value="1.10">נלחמת על תואר/ירידה (+10%)</option>
                  <option value="1.0">רגיל</option>
                  <option value="0.90">עייפות מאירופה / חוסר עניין (-10%)</option>
                </select>
              </Field>
              <Field label="פקטור עומס ומוטיבציה — חוץ">
                <select style={inp} value={motAway} onChange={e => setMotAway(e.target.value)}>
                  <option value="1.10">נלחמת על תואר/ירידה (+10%)</option>
                  <option value="1.0">רגיל</option>
                  <option value="0.90">עייפות מאירופה / חוסר עניין (-10%)</option>
                </select>
              </Field>
            </div>

            <SectionLabel>4. מדד איום צפוי (Expected Threat — xT)</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="דומיננטיות בשליש אחרון — בית">
                <select style={inp} value={xtHome} onChange={e => setXtHome(e.target.value)}>
                  <option value="0.10">לחץ גבוה ואיומים רציפים (+0.1 שער)</option>
                  <option value="0">תואם ל-xG הקיים</option>
                  <option value="-0.10">מתקשה לייצר סכנה (-0.1 שער)</option>
                </select>
              </Field>
              <Field label="דומיננטיות בשליש אחרון — חוץ">
                <select style={inp} value={xtAway} onChange={e => setXtAway(e.target.value)}>
                  <option value="0.10">לחץ גבוה ואיומים רציפים (+0.1 שער)</option>
                  <option value="0">תואם ל-xG הקיים</option>
                  <option value="-0.10">מתקשה לייצר סכנה (-0.1 שער)</option>
                </select>
              </Field>
            </div>

            <p style={{ fontWeight: 700, color: "#0f172a", fontSize: 13, margin: "16px 0 6px" }}>
              נתוני שוק (סוכן הימורים)
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="יחס סוכן ל-Over 2.5">
                <input style={inpMono} type="number" value={bookieOver} step="0.01"
                  onChange={e => setBookieOver(e.target.value)} />
              </Field>
              <Field label="יחס סוכן ל-Under 2.5">
                <input style={inpMono} type="number" value={bookieUnder} step="0.01"
                  onChange={e => setBookieUnder(e.target.value)} />
              </Field>
            </div>

            <button
              onClick={runModel}
              style={{
                width: "100%", background: "#2563eb", color: "white",
                border: "none", padding: 13, borderRadius: 8,
                cursor: "pointer", fontWeight: 700, fontSize: 16, marginTop: 18,
              }}
            >
              הרץ מודל משולב
            </button>
          </div>

          {/* ── Output Card ── */}
          <div style={card}>
            <h2 style={cardTitleStyle}>פלט מודל משוקלל וטבלאות ערך</h2>

            {/* xG summary */}
            <div style={{
              background: "#f8fafc", padding: 14, borderRadius: 8,
              marginBottom: 18, borderRight: "4px solid #2563eb",
            }}>
              <strong>שורה תחתונה של ה-xG המשוקלל:</strong>
              <br />
              {output ? (
                <span style={{ color: "#2563eb", fontSize: 14 }}>
                  <strong>בית משוקלל:</strong> <span style={{ fontFamily: "var(--font-mono), monospace" }}>{output.xgHome.toFixed(2)} xG</span> &nbsp;|&nbsp;
                  <strong>חוץ משוקלל:</strong> <span style={{ fontFamily: "var(--font-mono), monospace" }}>{output.xgAway.toFixed(2)} xG</span>
                </span>
              ) : (
                <span style={{ color: "#94a3b8" }}>אנא הרץ את המודל...</span>
              )}
            </div>

            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 10px" }}>
              טבלת בדיקת ערך (The Winning Method)
            </h3>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
                <thead>
                  <tr>
                    {["שוק ההימור", "הסתברות מודל", "יחס הוגן", "יחס סוכן", "בדיקת ערך"].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {output ? (
                    [
                      {
                        label: "Over 2.5",
                        prob: output.overProb,
                        fair: output.fairOver,
                        bookie: parseFloat(bookieOver),
                        hasValue: output.hasOverValue,
                      },
                      {
                        label: "Under 2.5",
                        prob: output.underProb,
                        fair: output.fairUnder,
                        bookie: parseFloat(bookieUnder),
                        hasValue: output.hasUnderValue,
                      },
                    ].map(row => (
                      <tr key={row.label}>
                        <td style={td}><strong>{row.label}</strong></td>
                        <td style={tdMono}>{row.prob.toFixed(1)}%</td>
                        <td style={tdMono}>{row.fair.toFixed(2)}</td>
                        <td style={tdMono}>{row.bookie.toFixed(2)}</td>
                        <td style={td}>
                          {row.hasValue ? (
                            <span style={{ background: "#dcfce7", color: "#16a34a", padding: "3px 8px", borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                              יש ערך! (סימון מומלץ)
                            </span>
                          ) : (
                            <span style={{ background: "#fee2e2", color: "#dc2626", padding: "3px 8px", borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                              אין ערך
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>
                        הרץ את המודל לקבלת תוצאות
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Explanation section */}
            {output && (
              <div style={{ marginTop: 24, fontSize: 12, color: "#64748b", lineHeight: 1.7 }}>
                <p style={{ margin: "0 0 6px", fontWeight: 700, color: "#334155" }}>כיצד מחושב המודל?</p>
                <p style={{ margin: 0 }}>
                  xG משוקלל = (xG בסיסי × כושר × (1 − פציעות) × מוטיבציה) + xT
                  <br />
                  הסתברות Under/Over מחושבת ע״י מטריצת פואסון (Poisson matrix).
                  ערך קיים כאשר יחס הסוכן גבוה מהיחס ההוגן של המודל.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
