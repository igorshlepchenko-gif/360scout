import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "ANALYST365 — מערכת חיזוי כדורגל",
  description: "פלטפורמת חיזוי כדורגל מתקדמת — ניתוח 360 מעלות: xG, מזג אוויר, שופט, פציעות, Value Bets וקונסנזוס מומחים.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
