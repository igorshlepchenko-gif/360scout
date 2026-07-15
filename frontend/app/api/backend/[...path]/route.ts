/**
 * Generic BFF proxy — /api/backend/<anything> forwards to the FastAPI backend
 * with the session's bearer token attached server-side. This is what lets the
 * browser call gated backend routes same-origin (so the httpOnly cookie never
 * needs to leave analyst365.net) instead of hitting Railway directly.
 */
import { NextResponse } from "next/server";
import { backendAuthHeaders } from "@/lib/session";

const BACKEND = process.env.API_URL ?? "http://localhost:8000";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxyToBackend(request: Request, pathSegments: string[]): Promise<NextResponse> {
  const url = new URL(request.url);
  const target = `${BACKEND}/${pathSegments.join("/")}${url.search}`;

  const headers: Record<string, string> = await backendAuthHeaders();

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "DELETE") {
    const text = await request.text();
    if (text) {
      body = text;
      headers["Content-Type"] = request.headers.get("Content-Type") ?? "application/json";
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });

    const contentType = upstream.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await upstream.json();
      return NextResponse.json(data, { status: upstream.status });
    }
    const text = await upstream.text();
    return NextResponse.json({ detail: text }, { status: upstream.status });
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

export async function GET(request: Request, { params }: RouteContext) {
  return proxyToBackend(request, (await params).path);
}

export async function POST(request: Request, { params }: RouteContext) {
  return proxyToBackend(request, (await params).path);
}

export async function PUT(request: Request, { params }: RouteContext) {
  return proxyToBackend(request, (await params).path);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return proxyToBackend(request, (await params).path);
}
