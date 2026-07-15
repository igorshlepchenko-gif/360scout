import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND = process.env.API_URL ?? "http://localhost:8000";
const SESSION_ABSOLUTE_HOURS = Number(process.env.SESSION_ABSOLUTE_HOURS ?? 24);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const upstream = await fetch(`${BACKEND}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await upstream.json();

    if (upstream.ok && typeof data.session_token === "string") {
      (await cookies()).set("session", data.session_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_ABSOLUTE_HOURS * 60 * 60,
      });
    }

    // Never forward the raw token to the browser — the cookie is enough,
    // and keeping it out of the JS-readable response body limits XSS exposure.
    const { session_token: _drop, ...safeData } = data;
    return NextResponse.json(safeData, { status: upstream.status });
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
