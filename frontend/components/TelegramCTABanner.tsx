"use client";

import { Send, Check, Zap, Bell, TrendingUp } from "lucide-react";

interface Props {
  /** Full Telegram invite link, e.g. https://t.me/analyst365 */
  href?: string;
  /** Compact variant for sidebars / between cards */
  variant?: "full" | "compact";
}

const PERKS = [
  { Icon: Zap,        text: "התראות Value Bet בזמן אמת" },
  { Icon: Bell,       text: "נעילות קונסנזוס לפני כולם" },
  { Icon: TrendingUp, text: "ניתוחים יומיים + Track Record" },
];

export default function TelegramCTABanner({ href = "https://t.me/analyst365", variant = "full" }: Props) {
  if (variant === "compact") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        dir="rtl"
        className="group flex items-center justify-between gap-3 rounded-2xl border border-sky-500/30 bg-gradient-to-l from-sky-500/15 to-sky-500/5 px-4 py-3 transition hover:border-sky-500/50 hover:from-sky-500/20"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-sky-500/20">
            <Send className="h-4 w-4 text-sky-400" />
          </div>
          <div>
            <div className="text-[13px] font-extrabold text-white">הצטרף לערוץ Analyst365</div>
            <div className="text-[11px] text-sky-300/70">סיגנלים חמים ישירות לטלגרם</div>
          </div>
        </div>
        <span className="rounded-full bg-sky-500 px-3 py-1.5 text-[11px] font-bold text-[#0B0E14] transition group-hover:bg-sky-400">
          הצטרפות
        </span>
      </a>
    );
  }

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-sky-500/30 bg-gradient-to-l from-sky-600/20 via-sky-500/10 to-transparent p-6 sm:p-8"
    >
      {/* glow */}
      <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-sky-500/20 blur-3xl" />

      <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div className="max-w-md">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold text-sky-300">
            <Send className="h-3 w-3" /> קהילת ANALYST365
          </div>
          <h3 className="text-xl font-black text-white sm:text-2xl">
            אל תפספס אף <span className="text-sky-400">Value Bet</span>
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
            הצטרף לערוץ הטלגרם וקבל התראות אוטומטיות ברגע שהאלגוריתם מזהה הזדמנות מול השוק.
          </p>

          <ul className="mt-4 space-y-2">
            {PERKS.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-2 text-[13px] text-slate-300">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-sky-500/15">
                  <Check className="h-3 w-3 text-sky-400" />
                </span>
                <Icon className="h-3.5 w-3.5 text-sky-400/70" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-6 py-3.5 text-sm font-extrabold text-[#0B0E14] shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 hover:shadow-sky-500/30 sm:w-auto"
        >
          <Send className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          הצטרפות חינם לערוץ
        </a>
      </div>
    </div>
  );
}
