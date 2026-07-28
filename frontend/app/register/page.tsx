"use client";
import { useState } from "react";

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
const wrap: React.CSSProperties = {
  background: "#f1f5f9", minHeight: "calc(100vh - 40px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20, direction: "rtl",
};

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    if (password.length < 8) {
      setError("הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "ההרשמה נכשלה");
        return;
      }
      setDone(true);
    } catch {
      setError("שגיאת רשת — נסה שוב");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div style={wrap}>
        <div style={card}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#0f172a", margin: "0 0 10px" }}>
            הבקשה נשלחה ✓
          </h1>
          <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.7, margin: "0 0 16px" }}>
            החשבון שלך ({email}) נוצר וממתין לאישור מנהל. תוכל להתחבר לאחר שהבקשה תאושר.
          </p>
          <a href="/login" style={{ color: "#2563eb", fontWeight: 600, fontSize: 14 }}>
            חזרה להתחברות
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <form onSubmit={onSubmit} style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#0f172a", margin: "0 0 4px" }}>
          הרשמה
        </h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 20px" }}>
          לאחר ההרשמה החשבון ימתין לאישור מנהל
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
            style={inp} type="password" required value={password} minLength={8}
            onChange={e => setPassword(e.target.value)} autoComplete="new-password"
          />
        </label>

        <label style={{ ...label, marginTop: 14 }}>
          אימות סיסמה
          <input
            style={inp} type="password" required value={confirm}
            onChange={e => setConfirm(e.target.value)} autoComplete="new-password"
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
          {loading ? "נרשם..." : "הרשמה"}
        </button>

        <p style={{ textAlign: "center", fontSize: 13, color: "#64748b", marginTop: 16 }}>
          כבר יש לך חשבון?{" "}
          <a href="/login" style={{ color: "#2563eb", fontWeight: 600 }}>התחברות</a>
        </p>
      </form>
    </div>
  );
}
