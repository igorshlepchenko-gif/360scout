"use client";
import { useState } from "react";

interface AdminUser {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string | null;
  approved_at: string | null;
}

type StatusTab = "pending" | "approved" | "rejected";

const STATUS_LABEL: Record<StatusTab, string> = {
  pending: "ממתינים לאישור",
  approved: "מאושרים",
  rejected: "נדחו",
};

const th: React.CSSProperties = {
  background: "#f8fafc", color: "#0f172a", padding: "10px 12px",
  fontWeight: 600, borderBottom: "2px solid #cbd5e1", fontSize: 13,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 13,
  color: "#334155",
};
const actionBtn: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, border: "none", color: "#fff",
  fontWeight: 600, fontSize: 12, cursor: "pointer",
};

export default function AdminPanel({ initialUsers }: { initialUsers: AdminUser[] }) {
  const [status, setStatus] = useState<StatusTab>("pending");
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadUsers(s: StatusTab) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/api/admin/users?status=${s}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "שגיאה בטעינת המשתמשים");
      setUsers(data.users ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בטעינת המשתמשים");
    } finally {
      setLoading(false);
    }
  }

  function switchTab(s: StatusTab) {
    setStatus(s);
    loadUsers(s);
  }

  async function act(userId: string, action: "approve" | "reject") {
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/backend/api/admin/users/${userId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "הפעולה נכשלה");
      await loadUsers(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הפעולה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(Object.keys(STATUS_LABEL) as StatusTab[]).map(s => (
          <button
            key={s}
            onClick={() => switchTab(s)}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
              background: status === s ? "#2563eb" : "#fff",
              color: status === s ? "#fff" : "#334155",
              fontWeight: 600, fontSize: 13, cursor: "pointer",
            }}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error && (
        <p style={{
          background: "#fee2e2", color: "#dc2626", padding: "8px 10px",
          borderRadius: 6, fontSize: 13, marginBottom: 12,
        }}>
          {error}
        </p>
      )}

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        {loading ? (
          <p style={{ padding: 20, color: "#94a3b8", textAlign: "center" }}>טוען...</p>
        ) : users.length === 0 ? (
          <p style={{ padding: 20, color: "#94a3b8", textAlign: "center" }}>אין משתמשים בקטגוריה זו</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
              <thead>
                <tr>
                  <th style={th}>אימייל</th>
                  <th style={th}>תפקיד</th>
                  <th style={th}>נרשם</th>
                  {status === "pending" && <th style={th}>פעולות</th>}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={td}>{u.email}</td>
                    <td style={td}>{u.role === "admin" ? "מנהל" : "משתמש"}</td>
                    <td style={td}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString("he-IL") : "—"}
                    </td>
                    {status === "pending" && (
                      <td style={td}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => act(u.id, "approve")}
                            disabled={busyId === u.id}
                            style={{ ...actionBtn, background: "#16a34a", opacity: busyId === u.id ? 0.6 : 1 }}
                          >
                            אשר
                          </button>
                          <button
                            onClick={() => act(u.id, "reject")}
                            disabled={busyId === u.id}
                            style={{ ...actionBtn, background: "#dc2626", opacity: busyId === u.id ? 0.6 : 1 }}
                          >
                            דחה
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
