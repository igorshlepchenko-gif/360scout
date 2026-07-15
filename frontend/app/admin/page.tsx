import { requireAdmin, backendAuthHeaders } from "@/lib/session";
import AdminPanel from "@/components/AdminPanel";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export default async function AdminPage() {
  await requireAdmin();

  const res = await fetch(`${API_URL}/api/admin/users?status=pending`, {
    cache: "no-store",
    headers: await backendAuthHeaders(),
  });
  const data = res.ok ? await res.json() : { users: [] };

  return (
    <div style={{ minHeight: "calc(100vh - 40px)", background: "#f1f5f9", padding: "32px 20px", direction: "rtl" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
          ניהול משתמשים
        </h1>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>
          אישור או דחייה של בקשות הרשמה לאתר
        </p>
        <AdminPanel initialUsers={data.users ?? []} />
      </div>
    </div>
  );
}
