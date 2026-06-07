import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "360SCOUT — ניתוח ספורט מתקדם",
  description: "מודל חיזוי 360 מעלות לכדורגל — xG, מזג אוויר, שופט, פציעות וקונסנזוס מומחים.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
