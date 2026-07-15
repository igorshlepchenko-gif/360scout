import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND = process.env.API_URL ?? "http://localhost:8000";

// Always succeeds from the client's point of view — logout is idempotent.
export async function POST() {
  const store = await cookies();
  const token = store.get("session")?.value;

  if (token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      await fetch(`${BACKEND}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      // best-effort — the cookie gets cleared below regardless
    } finally {
      clearTimeout(timeout);
    }
  }

  store.delete("session");
  return NextResponse.json({ status: "success" });
}
