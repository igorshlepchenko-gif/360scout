"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import RadarMark from "@/components/RadarMark";

const NAV_ITEMS = [
  { label: "סיגנלים חמים",      href: "/" },
  { label: "כל המשחקים",        href: "/matches" },
  { label: "ביצועים היסטוריים", href: "/track-record" },
  { label: "אנליסטים",          href: "/analysts" },
];

export default function NavBar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { user, loading: authLoading } = useCurrentUser();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // Hard redirect — drops any stale in-memory state from data fetched while logged in.
    window.location.href = "/login";
  }

  return (
    <>
      <nav
        aria-label="ניווט ראשי"
        style={{
          position: "sticky", top: 40, zIndex: 60,
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
            style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 20, letterSpacing: "-0.3px", textDecoration: "none", direction: "ltr", flexShrink: 0 }}
          >
            <RadarMark size={24} />
            <span>
              <span style={{ color: "var(--scan-500)" }}>ANALYST</span>
              <span style={{ color: "white" }}>365</span>
            </span>
          </a>

          {/* Desktop links — hidden on mobile via CSS */}
          <div className="nav-desktop-links" style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {NAV_ITEMS.map(item => (
              <a
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
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

            {!authLoading && (
              <div style={{
                display: "flex", alignItems: "center", gap: 14,
                borderRight: "1px solid rgba(255,255,255,0.12)", paddingRight: 20,
              }}>
                {user ? (
                  <>
                    {user.role === "admin" && (
                      <a href="/admin" style={{ color: "#64748b", fontSize: 14, textDecoration: "none", whiteSpace: "nowrap" }}>
                        ניהול
                      </a>
                    )}
                    <span style={{ color: "#64748b", fontSize: 13, whiteSpace: "nowrap" }}>{user.email}</span>
                    <button
                      onClick={handleLogout}
                      style={{
                        background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
                        color: "#94a3b8", fontSize: 13, padding: "5px 12px", borderRadius: 6,
                        cursor: "pointer", whiteSpace: "nowrap",
                      }}
                    >
                      התנתקות
                    </button>
                  </>
                ) : (
                  <>
                    <a href="/login" style={{ color: "#64748b", fontSize: 14, textDecoration: "none", whiteSpace: "nowrap" }}>
                      התחברות
                    </a>
                    <a href="/register" style={{ color: "var(--scan-500)", fontSize: 14, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                      הרשמה
                    </a>
                  </>
                )}
              </div>
            )}
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
                aria-current={isActive(item.href) ? "page" : undefined}
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
                  <span style={{ width: 3, height: 20, background: "var(--scan-500)", borderRadius: 99, display: "inline-block", flexShrink: 0 }} />
                )}
                {item.label}
              </a>
            ))}

            {!authLoading && (
              user ? (
                <>
                  {user.role === "admin" && (
                    <a
                      href="/admin"
                      onClick={() => setOpen(false)}
                      style={{
                        color: isActive("/admin") ? "white" : "#94a3b8",
                        fontSize: 16, fontWeight: isActive("/admin") ? 700 : 400,
                        textDecoration: "none", padding: "13px 0",
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      ניהול
                    </a>
                  )}
                  <div style={{
                    color: "#64748b", fontSize: 14, padding: "13px 0",
                    borderTop: user.role === "admin" ? "none" : "1px solid rgba(255,255,255,0.06)",
                  }}>
                    {user.email}
                  </div>
                  <button
                    onClick={handleLogout}
                    style={{
                      color: "#94a3b8", fontSize: 16, textDecoration: "none",
                      padding: "13px 0", background: "none", border: "none",
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      textAlign: "right", cursor: "pointer", width: "100%",
                    }}
                  >
                    התנתקות
                  </button>
                </>
              ) : (
                <>
                  <a
                    href="/login"
                    onClick={() => setOpen(false)}
                    style={{
                      color: isActive("/login") ? "white" : "#94a3b8",
                      fontSize: 16, fontWeight: isActive("/login") ? 700 : 400,
                      textDecoration: "none", padding: "13px 0",
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    התחברות
                  </a>
                  <a
                    href="/register"
                    onClick={() => setOpen(false)}
                    style={{
                      color: "var(--scan-500)", fontSize: 16, fontWeight: 700,
                      textDecoration: "none", padding: "13px 0",
                    }}
                  >
                    הרשמה
                  </a>
                </>
              )
            )}
          </div>
        )}
      </nav>
    </>
  );
}
