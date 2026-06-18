"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

const NAV_ITEMS = [
  { label: "סיגנלים חמים",      href: "/" },
  { label: "🏆 מונדיאל 2026",   href: "/world-cup" },
  { label: "כל המשחקים",        href: "/matches" },
  { label: "ביצועים היסטוריים", href: "/track-record" },
  { label: "אנליסטים",          href: "/analysts" },
];

export default function NavBar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(11,14,20,0.95)",
        backdropFilter: "blur(12px)",
      }}>
        <div style={{
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          {/* Logo — first in RTL = visually RIGHT */}
          <a
            href="/"
            style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-0.5px", textDecoration: "none", direction: "ltr", flexShrink: 0 }}
          >
            <span style={{ color: "#10b981" }}>ANALYST</span>
            <span style={{ color: "white" }}>365</span>
          </a>

          {/* Desktop links — hidden on mobile via CSS */}
          <div className="nav-desktop-links" style={{ display: "flex", gap: 24 }}>
            {NAV_ITEMS.map(item => (
              <a
                key={item.href}
                href={item.href}
                style={{
                  color: isActive(item.href) ? "white" : "#64748b",
                  fontSize: 14,
                  fontWeight: isActive(item.href) ? 600 : 400,
                  textDecoration: "none",
                  transition: "color 0.2s",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </a>
            ))}
          </div>

          {/* Hamburger — last in RTL = visually LEFT — shown on mobile only */}
          <button
            className="nav-hamburger"
            onClick={() => setOpen(o => !o)}
            aria-label="תפריט"
            aria-expanded={open}
            style={{
              display: "none",
              alignItems: "center",
              justifyContent: "center",
              background: open ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              padding: "7px 10px",
              color: "white",
              cursor: "pointer",
              transition: "background 0.15s",
            }}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile dropdown — anchored to the nav's bottom edge (top:100%)
            so it never overlaps the nav regardless of its height */}
        {open && (
          <div
            style={{
              position: "absolute",
              top: "100%", left: 0, right: 0,
              zIndex: 49,
              background: "#0B0E14",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 12px 24px rgba(0,0,0,0.5)",
              padding: "6px 20px 14px",
              display: "flex",
              flexDirection: "column",
              maxHeight: "calc(100vh - 100px)",
              overflowY: "auto",
            }}
          >
            {NAV_ITEMS.map((item, i) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                style={{
                  color: isActive(item.href) ? "white" : "#94a3b8",
                  fontSize: 16,
                  fontWeight: isActive(item.href) ? 700 : 400,
                  textDecoration: "none",
                  padding: "13px 0",
                  borderBottom: i < NAV_ITEMS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                {isActive(item.href) && (
                  <span style={{ width: 3, height: 20, background: "#10b981", borderRadius: 99, display: "inline-block", flexShrink: 0 }} />
                )}
                {item.label}
              </a>
            ))}
          </div>
        )}
      </nav>
    </>
  );
}
