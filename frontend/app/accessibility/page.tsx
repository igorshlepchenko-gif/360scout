import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "הצהרת נגישות — ANALYST365",
  description: "הצהרת הנגישות של ANALYST365 — מידע על רמת הנגישות, תכונות הנגישות המיושמות ואמצעי יצירת קשר לפניות נגישות.",
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-labelledby={`section-${title}`} style={{ marginBottom: 40 }}>
    <h2
      id={`section-${title}`}
      style={{
        fontSize: 20, fontWeight: 800, color: "#10b981",
        marginBottom: 14, paddingBottom: 8,
        borderBottom: "1px solid rgba(16,185,129,0.2)",
      }}
    >
      {title}
    </h2>
    {children}
  </section>
);

const Li = ({ children }: { children: React.ReactNode }) => (
  <li style={{ color: "#cbd5e1", fontSize: 15, lineHeight: 1.8, paddingBottom: 4 }}>
    {children}
  </li>
);

export default function AccessibilityPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0B0E14" }}>
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "48px 32px" }}>

        {/* Page header */}
        <header style={{ marginBottom: 48 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
            borderRadius: 99, padding: "4px 14px", marginBottom: 16,
          }}>
            <span style={{ fontSize: 18 }} aria-hidden="true">♿</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981" }}>הצהרת נגישות</span>
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: "white", marginBottom: 12 }}>
            נגישות האתר — ANALYST365
          </h1>
          <p style={{ color: "#94a3b8", fontSize: 16, lineHeight: 1.7 }}>
            אנו ב-ANALYST365 מחויבים להנגשת שירותינו לכל משתמש, לרבות אנשים עם מוגבלויות.
            הצהרה זו מפרטת את מצב הנגישות של האתר, את הפעולות שננקטו וכיצד ניתן לפנות אלינו.
          </p>
        </header>

        {/* Legal basis */}
        <Section title="בסיס חוקי">
          <p style={{ color: "#94a3b8", fontSize: 15, lineHeight: 1.8 }}>
            הנגשת האתר בוצעה בהתאם ל<strong style={{ color: "white" }}>תקנות שוויון זכויות לאנשים עם מוגבלות
            (התאמות נגישות לשירות), תשע&quot;ג-2013</strong>, המחייבות עמידה ברמה{" "}
            <strong style={{ color: "#10b981" }}>AA של תקן WCAG 2.1</strong>{" "}
            (Web Content Accessibility Guidelines — הנחיות לנגישות תוכן אינטרנט, גרסה 2.1).
          </p>
          <div style={{
            marginTop: 16,
            background: "rgba(16,185,129,0.06)",
            border: "1px solid rgba(16,185,129,0.18)",
            borderRadius: 10, padding: "14px 18px",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ fontSize: 22 }} aria-hidden="true">🏅</span>
            <div>
              <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>רמת ציות: AA — WCAG 2.1</div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                ציות חלקי — ראו &quot;מגבלות ידועות&quot; בהמשך
              </div>
            </div>
          </div>
        </Section>

        {/* Implemented features */}
        <Section title="תכונות נגישות המיושמות באתר">
          <ul style={{ paddingRight: 20, listStyleType: "disc" }}>
            <Li>שפת האתר מוגדרת לעברית (<code>lang=&quot;he&quot;</code>) וכיוון קריאה מימין לשמאל (<code>dir=&quot;rtl&quot;</code>)</Li>
            <Li>קישור &quot;דלג לתוכן הראשי&quot; מופיע בראש כל עמוד עבור משתמשי מקלדת</Li>
            <Li>כל האלמנטים האינטראקטיביים (כפתורים, קישורים) נגישים דרך מקלדת ומציגים טבעת פוקוס ברורה</Li>
            <Li>ניווט ראשי מסומן כ-landmark (<code>aria-label=&quot;ניווט ראשי&quot;</code>) לקוראי מסך</Li>
            <Li>קישור פעיל בניווט מסומן עם <code>aria-current=&quot;page&quot;</code></Li>
            <Li>כפתורים עם אייקונים בלבד כוללים <code>aria-label</code> תיאורי בעברית</Li>
            <Li>לוגואים של קבוצות ספורט כוללים טקסט חלופי (<code>alt</code>) עם שם הקבוצה</Li>
            <Li>אנימציות ומעברים מכובדים — תמיכה מלאה ב-<code>prefers-reduced-motion</code></Li>
            <Li>אלמנטים דקורטיביים (גרפים, אייקונים ויזואליים) מוסתרים מקוראי מסך (<code>aria-hidden=&quot;true&quot;</code>)</Li>
            <Li>אזורי עדכון דינמיים (טעינת נתונים, תוצאות) מסומנים כ-<code>role=&quot;status&quot;</code></Li>
            <Li>מחוון &quot;שידור חי&quot; כולל תיאור קולי לקוראי מסך</Li>
            <Li>פאנלים מתרחבים כוללים מאפיין <code>aria-expanded</code> המשקף את מצבם</Li>
            <Li>טבלאות נתונים כוללות <code>caption</code> נסתר המתאר את תוכן הטבלה לקוראי מסך</Li>
            <Li>גופן ברור וקריא: Segoe UI / Arial Hebrew / מערכת</Li>
            <Li>גודל גופן בסיסי של 14–16px לתוכן ראשי</Li>
            <Li>תמיכה בהגדלת טקסט עד 200% ללא אובדן תוכן או פונקציונליות</Li>
            <Li>פריסה רספונסיבית המותאמת למובייל, טאבלט ושולחן עבודה</Li>
          </ul>
        </Section>

        {/* Known limitations */}
        <Section title="מגבלות ידועות">
          <div style={{
            background: "rgba(245,158,11,0.06)",
            border: "1px solid rgba(245,158,11,0.18)",
            borderRadius: 10, padding: "14px 18px", marginBottom: 16,
          }}>
            <p style={{ color: "#f59e0b", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>⚠ ידוע לנו על המגבלות הבאות ואנו פועלים לשיפורן:</p>
          </div>
          <ul style={{ paddingRight: 20, listStyleType: "disc" }}>
            <Li>
              <strong style={{ color: "white" }}>ניגודיות צבעים:</strong>{" "}
              חלק מהטקסט המשני (תוויות קטנות, תאריכים) עשוי להציג יחס ניגודיות מתחת ל-4.5:1 הנדרש
              לטקסט רגיל. טקסט גדול (18px+ או 14px+ bold) עומד בדרישת 3:1.
            </Li>
            <Li>
              <strong style={{ color: "white" }}>טבלאות מורכבות:</strong>{" "}
              טבלאות ניתוח הסתברות (שיטת הניצחון) מכילות נתונים רב-ממדיים שחלקם עשויים להיות
              מאתגרים לניווט עם קורא מסך. אנו עובדים על שיפור מבנה הטבלאות.
            </Li>
            <Li>
              <strong style={{ color: "white" }}>תמונות לוגואים חיצוניות:</strong>{" "}
              לוגואים של קבוצות נטענים מ-API חיצוני; כשתמונה נכשלת, מוצגות ראשי תיבות כחלופה.
            </Li>
            <Li>
              <strong style={{ color: "white" }}>תוכן המתעדכן בזמן אמת:</strong>{" "}
              טיקר המבזקים (World Cup) פועל כאנימציה נגלגלת. עצירתו מתאפשרת ב-hover;
              משתמשי מקלדת יכולים לעצור אנימציות דרך הגדרות מערכת ההפעלה (prefers-reduced-motion).
            </Li>
          </ul>
        </Section>

        {/* Contact */}
        <Section title="יצירת קשר בנושא נגישות">
          <p style={{ color: "#94a3b8", fontSize: 15, lineHeight: 1.8, marginBottom: 16 }}>
            נתקלתם בבעיית נגישות? זקוקים לתוכן בפורמט נגיש אחר? אנחנו כאן לעזור.
          </p>
          <div style={{
            background: "rgba(56,189,248,0.06)",
            border: "1px solid rgba(56,189,248,0.18)",
            borderRadius: 12, padding: "20px 24px",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }} aria-hidden="true">📧</span>
                <div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>דוא&quot;ל לפניות נגישות</div>
                  <a
                    href="mailto:igor.shlepchenko@gmail.com"
                    style={{ color: "#38bdf8", fontSize: 15, fontWeight: 700, textDecoration: "underline" }}
                  >
                    igor.shlepchenko@gmail.com
                  </a>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }} aria-hidden="true">⏱</span>
                <div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>זמן תגובה</div>
                  <div style={{ color: "#cbd5e1", fontSize: 15, fontWeight: 600 }}>עד 5 ימי עסקים</div>
                </div>
              </div>
            </div>
          </div>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 12, lineHeight: 1.7 }}>
            בפנייתכם אנא ציינו: את הדף שבו נתקלתם בבעיה, תיאור הבעיה, הדפדפן/מכשיר שבהם אתם משתמשים,
            וטכנולוגיית עזר אם רלוונטי (קורא מסך, מקלדת בלבד וכד&apos;).
          </p>
        </Section>

        {/* Date */}
        <div style={{
          marginTop: 48,
          paddingTop: 24,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 8,
        }}>
          <span style={{ color: "#334155", fontSize: 12 }}>
            ANALYST365 — מערכת חיזוי כדורגל
          </span>
          <span style={{ color: "#334155", fontSize: 12 }}>
            הצהרה זו עודכנה לאחרונה: <time dateTime="2026-06-21">יוני 2026</time>
          </span>
        </div>

      </main>
    </div>
  );
}
