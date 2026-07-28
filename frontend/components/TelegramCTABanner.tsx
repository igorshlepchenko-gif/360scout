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

export default function TelegramCTABanner({ href = "https://t.me/Malmilyan", variant = "full" }: Props) {
  if (variant === "compact") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        dir="rtl"
        className="group flex items-center justify-between gap-3 rounded-2xl border border-[#22D3EE]/30 bg-gradient-to-l from-[#22D3EE]/15 to-[#22D3EE]/5 px-4 py-3 transition hover:border-[#22D3EE]/50 hover:from-[#22D3EE]/20"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#22D3EE]/20">
            <Send className="h-4 w-4 text-[#22D3EE]" />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-white">הצטרף לערוץ Analyst365</div>
            <div className="text-[11px] text-[#22D3EE]/70">סיגנלים חמים ישירות לטלגרם</div>
          </div>
        </div>
        <span className="rounded-full bg-[#22D3EE] px-3 py-1.5 text-[11px] font-bold text-[#0B0E14] transition group-hover:bg-[#22D3EE]">
          הצטרפות
        </span>
      </a>
    );
  }

  return (
    <div
      dir="rtl"
      className="relative overflow-hidden rounded-2xl border border-[#22D3EE]/30 bg-gradient-to-l from-[#22D3EE]/20 via-[#22D3EE]/10 to-transparent p-6 sm:p-8"
    >
      {/* glow */}
      <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-[#22D3EE]/20 blur-3xl" />

      <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div className="max-w-md">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[#22D3EE]/30 bg-[#22D3EE]/10 px-2.5 py-1 text-[11px] font-bold text-[#22D3EE]">
            <Send className="h-3 w-3" /> קהילת ANALYST365
          </div>
          <h3 className="text-xl font-bold text-white sm:text-2xl">
            אל תפספס אף <span className="text-[#22D3EE]">Value Bet</span>
          </h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
            הצטרף לערוץ הטלגרם וקבל התראות אוטומטיות ברגע שהאלגוריתם מזהה הזדמנות מול השוק.
          </p>

          <ul className="mt-4 space-y-2">
            {PERKS.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-2 text-[13px] text-slate-300">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#22D3EE]/15">
                  <Check className="h-3 w-3 text-[#22D3EE]" />
                </span>
                <Icon className="h-3.5 w-3.5 text-[#22D3EE]/70" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#22D3EE] px-6 py-3.5 text-sm font-semibold text-[#0B0E14] shadow-lg shadow-[#22D3EE]/20 transition hover:bg-[#22D3EE] hover:shadow-[#22D3EE]/30 sm:w-auto"
        >
          <Send className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          הצטרפות חינם לערוץ
        </a>
      </div>
    </div>
  );
}
