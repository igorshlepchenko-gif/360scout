"use client";

export interface TickerItem {
  text: string;
}

const DEFAULT_ITEMS: TickerItem[] = [
  { text: "🏆 מונדיאל 2026: מודל 'The Winning Method' מזהה ערך חיובי — עקבו אחר הסיגנלים החמים!" },
  { text: "📊 נתוני xG משוקללים: המערכת מנתחת כל משחק בזמן אמת לזיהוי הזדמנויות ערך." },
  { text: "🎯 סימון חם: אחוזי הפגיעה היומיים של האנליסטים עומדים כרגע על 78%!" },
  { text: "⚽ ההרכבים הרשמיים יעודכנו אוטומטית שעה לפני שריקת הפתיחה — בדקו את הכרטיסיות." },
  { text: "⚡ Value Bet שזוהה? קבלו התראה מיידית בערוץ הטלגרם שלנו — הצטרפו עכשיו!" },
];

export default function WorldCupTicker({
  items = DEFAULT_ITEMS,
}: {
  items?: TickerItem[];
}) {
  if (!items.length) return null;

  // duplicate items so the scroll feels seamless
  const allItems = [...items, ...items];

  return (
    <div
      style={{
        display: "flex",
        background: "linear-gradient(90deg, #1e293b, #0f172a)",
        color: "#ffffff",
        direction: "rtl",
        height: 40,
        alignItems: "center",
        borderBottom: "2px solid #38bdf8",
        overflow: "hidden",
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        zIndex: 9999,
      }}
    >
      {/* Fixed label */}
      <div
        style={{
          background: "#e11d48",
          color: "white",
          padding: "0 15px",
          height: "100%",
          display: "flex",
          alignItems: "center",
          fontWeight: "bold",
          fontSize: "0.875rem",
          whiteSpace: "nowrap",
          boxShadow: "5px 0 15px rgba(0,0,0,0.3)",
          zIndex: 2,
          flexShrink: 0,
        }}
      >
        🔥 המלצות מונדיאל לייב:
      </div>

      {/* Scrolling area */}
      <div
        className="ticker-wrap"
        style={{
          flexGrow: 1,
          overflow: "hidden",
          height: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          className="ticker-items"
          style={{
            display: "flex",
            whiteSpace: "nowrap",
            paddingRight: "100%",
          }}
        >
          {allItems.map((item, i) => (
            <span
              key={i}
              style={{
                padding: "0 40px",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#f1f5f9",
              }}
            >
              {item.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
