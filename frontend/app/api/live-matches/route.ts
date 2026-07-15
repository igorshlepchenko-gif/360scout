/**
 * GET /api/live-matches
 * ─────────────────────
 * Client-side proxy to the backend — explicitly no-cache so the browser
 * always bypasses Next.js ISR and gets fresh data on every poll.
 *
 * This is the only route the frontend polling hooks should call.
 * The server-side page.tsx may keep revalidate:120 for its initial load;
 * live data after that flows through here.
 */

import { NextResponse } from "next/server";
import { backendAuthHeaders } from "@/lib/session";

const BACKEND = process.env.API_URL ?? "http://localhost:8000";

// Next.js App Router: opt out of all static/edge caching for this route
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit") ?? "8";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const upstream = await fetch(
      `${BACKEND}/api/live/matches?limit=${limit}`,
      { cache: "no-store", signal: controller.signal, headers: await backendAuthHeaders() }
    );
    clearTimeout(timeout);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "backend error", status: upstream.status },
        { status: upstream.status }
      );
    }

    const data = await upstream.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Surrogate-Control": "no-store",
      },
    });
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = (err as Error)?.name === "AbortError";
    return NextResponse.json(
      { error: isAbort ? "backend timeout" : "fetch failed" },
      { status: 503 }
    );
  }
}
