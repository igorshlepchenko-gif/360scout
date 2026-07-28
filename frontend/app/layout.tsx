import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Hebrew, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import CookieConsent from "@/components/CookieConsent";

const plexSansHebrew = IBM_Plex_Sans_Hebrew({
  weight: ["400", "500", "600", "700"],
  subsets: ["hebrew", "latin"],
  variable: "--font-plex-sans-hebrew",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

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
    <html lang="he" dir="rtl" className={`${plexSansHebrew.variable} ${plexMono.variable}`}>
      <body style={{ paddingTop: 40 }}>
        <a href="#main-content" className="skip-link">דלג לתוכן הראשי</a>
        <NavBar />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <CookieConsent />
      </body>
    </html>
  );
}
