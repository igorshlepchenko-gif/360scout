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
  const prevStatusRef = useRef<string | null>(statusShort ?? null);

  // ── Snap to server value on elapsed change OR status transition ──────────
  // Tracking statusShort fixes HT→2H: the API can send elapsed=45 for both
  // the last HT poll and the first 2H poll (same number, different half).
  // Without the status check, prevServerRef=45 blocks the snap and the ticker
  // runs uncapped from 45 with no re-anchor.
  useEffect(() => {
    const se = serverElapsed ?? null;
    if (se === null) return;
    if (se !== prevServerRef.current || statusShort !== prevStatusRef.current) {
      setLocalElapsed(prev => (se > prev ? se : prev)); // never go backwards
      prevServerRef.current = se;
      prevStatusRef.current = statusShort ?? null;
    }
  }, [serverElapsed, statusShort]);

  // ── Independent minute ticker ────────────────────────────────────────────
  // Cap prevents overflow during stoppage time, VAR delays, or long ET.
  const isTicking = TICKING_STATUSES.has(statusShort ?? "");
  useEffect(() => {
    if (!isTicking) return;
    const id = setInterval(() => {
      const max = statusShort === "ET" ? 120 : statusShort === "2H" ? 90 : 45;
      setLocalElapsed(prev => Math.min(prev + 1, max));
    }, 60_000);
    return () => clearInterval(id);
  }, [isTicking, statusShort]);

  // ── Display string ───────────────────────────────────────────────────────
  if (statusShort === "HT")  return "מחצית";
  if (statusShort === "FT"  ||
      statusShort === "AET" ||
      statusShort === "PEN") return "נגמר";
  if (!statusShort || statusShort === "NS") return "";

  return `${localElapsed}'`;
}
