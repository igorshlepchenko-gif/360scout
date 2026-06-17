"use client";
import { useState, useEffect, useRef } from "react";

// Statuses where the match clock is running
const TICKING_STATUSES = new Set(["1H", "2H", "ET", "LIVE"]);

/**
 * useLiveClock
 * ────────────
 * Maintains a client-side minute ticker independent of API polling.
 *
 * Rules:
 *   1. Ticks +1 every real minute while status is active (1H / 2H / ET).
 *   2. Snaps to the server's elapsed value whenever it changes — this is
 *      the "event anchor": goals, cards, and half-time trigger a new
 *      server value which resets drift immediately.
 *   3. Never goes backwards — if the server sends a stale elapsed that is
 *      lower than the local clock, we keep the local value.
 *   4. Returns an empty string for unstarted matches (NS / null).
 */
export function useLiveClock(
  serverElapsed: number | null | undefined,
  statusShort: string | null | undefined
): string {
  const [localElapsed, setLocalElapsed] = useState<number>(serverElapsed ?? 0);
  const prevServerRef = useRef<number | null>(serverElapsed ?? null);

  // ── Snap to server value when the API reports a new elapsed ─────────────
  // A change in serverElapsed means an event (goal, card, HT) was detected.
  useEffect(() => {
    const se = serverElapsed ?? null;
    if (se === null) return;
    if (se !== prevServerRef.current) {
      setLocalElapsed(prev => (se > prev ? se : prev)); // never go backwards
      prevServerRef.current = se;
    }
  }, [serverElapsed]);

  // ── Independent minute ticker ────────────────────────────────────────────
  const isTicking = TICKING_STATUSES.has(statusShort ?? "");
  useEffect(() => {
    if (!isTicking) return;
    const id = setInterval(() => setLocalElapsed(prev => prev + 1), 60_000);
    return () => clearInterval(id);
  }, [isTicking]);

  // ── Display string ───────────────────────────────────────────────────────
  if (statusShort === "HT")  return "מחצית";
  if (statusShort === "FT"  ||
      statusShort === "AET" ||
      statusShort === "PEN") return "נגמר";
  if (!statusShort || statusShort === "NS") return "";

  return `${localElapsed}'`;
}
