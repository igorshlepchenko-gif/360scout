import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANALYST365 — מערכת חיזוי כדורגל",
  description: "פלטפורמת חיזוי כדורגל מתקדמת — ניתוח 360 מעלות: xG, מזג אוויר, שופט, פציעות, Value Bets וקונסנזוס מומחים.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
