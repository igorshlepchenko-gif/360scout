/**
 * 360SCOUT — Session helpers (Server Components / Route Handlers only).
 * Reads the httpOnly `session` cookie and verifies it against the FastAPI
 * backend on every call — this, not proxy.ts, is the real per-page auth check
 * (Next's own docs warn against relying on Proxy alone for authorization).
 * Uses `next/headers` internally, which already throws if imported into a
 * Client Component, so there's no separate "server-only" guard needed here.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const BACKEND = process.env.API_URL ?? "http://localhost:8000";

export interface SessionUser {
  id: string;
  email: string;
  role: "user" | "admin";
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get("session")?.value ?? null;
}

export async function backendAuthHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch(`${BACKEND}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!upstream.ok) return null;
    return (await upstream.json()) as SessionUser;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requireApprovedUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireApprovedUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
