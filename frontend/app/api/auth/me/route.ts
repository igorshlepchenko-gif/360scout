import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

const BACKEND = process.env.API_URL ?? "http://localhost:8000";

export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const upstream = await fetch(`${BACKEND}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    return NextResponse.json(
      { detail: isAbort ? "Backend timeout" : "Could not reach backend" },
      { status: 503 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
