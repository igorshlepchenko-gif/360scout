"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "analyst365_cookie_consent";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) setVisible(true);
  }, []);

  function accept() {
    localStorage.setItem(STORAGE_KEY, "accepted");
    setVisible(false);
  }

  function decline() {
    localStorage.setItem(STORAGE_KEY, "declined");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="הודעת שימוש בעוגיות"
      dir="rtl"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        left: 20,
        zIndex: 9000,
        maxWidth: 560,
        margin: "0 auto",
        background: "#0F1318",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        boxShadow: "0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,185,129,0.1)",
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 22 }} aria-hidden="true">🍪</span>
        <div>
          <div style={{ color: "white", fontWeight: 800, fontSize: 15 }}>
            האתר משתמש בעוגיות (Cookies)
          </div>
          <div style={{ color: "#64748b", fontSize: 11, marginTop: 1 }}>
            נדרשת הסכמתך בהתאם לחוק הגנת הפרטיות
          </div>
        </div>
      </div>

      {/* Body */}
      <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.7, margin: 0 }}>
        אנו משתמשים בעוגיות ובאחסון מקומי (localStorage) כדי לשמור את העדפותיך
        ולשפר את חוויית השימוש.{" "}
        <strong style={{ color: "#cbd5e1" }}>אין אנו עוקבים אחריך ואין אנו מוכרים נתונים לצדדים שלישיים.</strong>
      </p>

      {/* Cookie types */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
        padding: "10px 14px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span style={{ color: "#10b981", fontSize: 12, marginTop: 1, flexShrink: 0 }}>✓</span>
          <div>
            <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 700 }}>עוגיות הכרחיות</span>
            <span style={{ color: "#475569", fontSize: 11 }}> — שמירת העדפות תצוגה ואחסון מקומי. תמיד פעילות.</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span style={{ color: "#64748b", fontSize: 12, marginTop: 1, flexShrink: 0 }}>○</span>
          <div>
            <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 700 }}>עוגיות ניתוח</span>
            <span style={{ color: "#475569", fontSize: 11 }}> — אנחנו לא משתמשים בכלי מעקב חיצוניים כגון Google Analytics.</span>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          onClick={decline}
          aria-label="דחה עוגיות לא-הכרחיות"
          style={{
            padding: "8px 18px",
            borderRadius: 99,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent",
            color: "#64748b",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: "color 0.2s, border-color 0.2s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
        >
          דחה
        </button>

        <a
          href="/accessibility"
          style={{
            padding: "8px 18px",
            borderRadius: 99,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent",
            color: "#475569",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            textDecoration: "none",
            transition: "color 0.2s",
            display: "flex", alignItems: "center",
          }}
        >
          מדיניות פרטיות
        </a>

        <button
          onClick={accept}
          aria-label="אשר שימוש בעוגיות"
          style={{
            padding: "8px 22px",
            borderRadius: 99,
            border: "none",
            background: "#10b981",
            color: "#0B0E14",
            fontSize: 13,
            fontWeight: 800,
            cursor: "pointer",
            transition: "background 0.2s, transform 0.1s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "#059669"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "#10b981"; }}
        >
          אשר הכל ✓
        </button>
      </div>

      {/* Legal note */}
      <p style={{ color: "#334155", fontSize: 10, margin: 0, lineHeight: 1.6 }}>
        בלחיצה על &quot;אשר הכל&quot; אתה מסכים לשימוש בעוגיות הכרחיות לפי{" "}
        <a href="/accessibility" style={{ color: "#475569", textDecoration: "underline" }}>
          מדיניות הפרטיות
        </a>{" "}
        שלנו. ניתן לשנות את ההעדפות בכל עת דרך הגדרות הדפדפן.
      </p>
    </div>
  );
}
