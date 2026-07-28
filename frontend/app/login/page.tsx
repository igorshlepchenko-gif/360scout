"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const card: React.CSSProperties = {
  background: "#fff", borderRadius: 12,
  boxShadow: "0 4px 10px rgba(0,0,0,0.07)",
  padding: 28, border: "1px solid #e2e8f0",
  maxWidth: 380, width: "100%",
};
const inp: React.CSSProperties = {
  width: "100%", padding: "10px 12px", border: "1px solid #cbd5e1",
  borderRadius: 6, boxSizing: "border-box", fontSize: 14,
  background: "#fff", color: "#334155", marginTop: 4,
};
const label: React.CSSProperties = {
  display: "block", fontWeight: 500, fontSize: 13, color: "#334155",
};
const button: React.CSSProperties = {
  width: "100%", background: "#2563eb", color: "white",
  border: "none", padding: 12, borderRadius: 8,
  cursor: "pointer", fontWeight: 700, fontSize: 15, marginTop: 18,
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Real validity check (not just cookie presence) — if a stale-but-still-valid
  // session already exists, skip straight past the form. Failure just leaves
  // the form showing; it never redirects anywhere else, so this can't loop.
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(res => { if (res.ok) router.replace("/"); })
      .catch(() => {});
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "ההתחברות נכשלה");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("שגיאת רשת — נסה שוב");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      background: "#f1f5f9", minHeight: "calc(100vh - 40px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, direction: "rtl",
    }}>
      <form onSubmit={onSubmit} style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#0f172a", margin: "0 0 4px" }}>
          התחברות
        </h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 20px" }}>
          גישה לאתר מוגבלת למשתמשים מאושרים
        </p>

        <label style={label}>
          אימייל
          <input
            style={inp} type="email" required value={email}
            onChange={e => setEmail(e.target.value)} autoComplete="email"
          />
        </label>

        <label style={{ ...label, marginTop: 14 }}>
          סיסמה
          <input
            style={inp} type="password" required value={password}
            onChange={e => setPassword(e.target.value)} autoComplete="current-password"
          />
        </label>

        {error && (
          <p style={{
            background: "#fee2e2", color: "#dc2626", padding: "8px 10px",
            borderRadius: 6, fontSize: 13, marginTop: 14,
          }}>
            {error}
          </p>
        )}

        <button type="submit" style={{ ...button, opacity: loading ? 0.7 : 1 }} disabled={loading}>
          {loading ? "מתחבר..." : "התחבר"}
        </button>

        <p style={{ textAlign: "center", fontSize: 13, color: "#64748b", marginTop: 16 }}>
          אין לך חשבון?{" "}
          <a href="/register" style={{ color: "#2563eb", fontWeight: 600 }}>הרשמה</a>
        </p>
      </form>
    </div>
  );
}
