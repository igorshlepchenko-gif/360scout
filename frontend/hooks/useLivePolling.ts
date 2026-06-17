"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { LiveMatch } from "@/components/MatchLiveRow";

// ── Polling intervals ────────────────────────────────────────────────────────
const INTERVAL_LIVE      = 20_000;   // 20 s — at least one active match
const INTERVAL_HALFTIME  = 35_000;   // 35 s — all matches at HT (less urgent)
const INTERVAL_SCHEDULED = 90_000;   // 90 s — waiting for kick-off
const INTERVAL_IDLE      = 180_000;  // 3 min — no games today

// ── Odds-drift re-fetch ──────────────────────────────────────────────────────
// If any bookmaker odds shift by this much, we treat it as an in-play event
// (goal confirmed, player sent off) and schedule an early extra fetch.
const DRIFT_THRESHOLD = 0.06;  // 6 cents decimal
const DRIFT_DELAY     = 4_000; // wait 4 s before the early re-fetch

// ── Helpers ─────────────────────────────────────────────────────────────────

function pickInterval(matches: LiveMatch[]): number {
  if (matches.some(m => m._status === "live" && m.status_short !== "HT"))
    return INTERVAL_LIVE;
  if (matches.some(m => m._status === "live"))   // all live are at HT
    return INTERVAL_HALFTIME;
  if (matches.some(m => m._status === "scheduled"))
    return INTERVAL_SCHEDULED;
  return INTERVAL_IDLE;
}

function oddsOf(m: LiveMatch): [number, number, number] {
  if (!m.value_bets) return [0, 0, 0];
  return [
    m.value_bets["home"]?.bookmaker_odds ?? 0,
    m.value_bets["draw"]?.bookmaker_odds ?? 0,
    m.value_bets["away"]?.bookmaker_odds ?? 0,
  ];
}

/** Returns true if ANY live match has odds that moved by ≥ DRIFT_THRESHOLD */
function hasDrift(prev: LiveMatch[], next: LiveMatch[]): boolean {
  for (const nm of next) {
    if (nm._status !== "live") continue;
    const pm = prev.find(m => m.fixture_id === nm.fixture_id);
    if (!pm) continue;
    const [ph, pd, pa] = oddsOf(pm);
    const [nh, nd, na] = oddsOf(nm);
    const pairs: [number, number][] = [[ph, nh], [pd, nd], [pa, na]];
    if (pairs.some(([a, b]) => a > 1 && b > 1 && Math.abs(a - b) >= DRIFT_THRESHOLD))
      return true;
  }
  return false;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseLivePollingResult {
  matches: LiveMatch[];
  lastUpdated: Date | null;
  isPending: boolean;
}

export function useLivePolling(initialMatches: LiveMatch[]): UseLivePollingResult {
  const [matches, setMatches]         = useState<LiveMatch[]>(initialMatches);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPending, setIsPending]     = useState(false);

  // Refs keep stable references across re-renders
  const matchesRef    = useRef<LiveMatch[]>(initialMatches);
  const isFetchingRef = useRef(false);       // guard against concurrent fetches
  const pollTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const driftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef    = useRef(true);
  const abortCtrlRef  = useRef<AbortController | null>(null);

  // ── Fetch function ─────────────────────────────────────────────────────────
  const doFetch = useCallback(async () => {
    if (isFetchingRef.current || !mountedRef.current) return;
    isFetchingRef.current = true;
    if (mountedRef.current) setIsPending(true);

    // Cancel any still-in-flight request before starting a new one
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = new AbortController();

    try {
      const res = await fetch("/api/live-matches?limit=8", {
        cache: "no-store",
        signal: abortCtrlRef.current.signal,
      });
      if (!res.ok || !mountedRef.current) return;

      const data = await res.json();
      const fresh: LiveMatch[] = data.matches ?? [];

      // Odds-drift detection: schedule early re-fetch if market moved
      if (hasDrift(matchesRef.current, fresh)) {
        if (driftTimerRef.current) clearTimeout(driftTimerRef.current);
        driftTimerRef.current = setTimeout(doFetch, DRIFT_DELAY);
      }

      matchesRef.current = fresh;
      if (mountedRef.current) {
        setMatches(fresh);
        setLastUpdated(new Date());
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return; // intentional cancel
      // Network error — silent, next scheduled poll will retry
    } finally {
      isFetchingRef.current = false;
      if (mountedRef.current) setIsPending(false);
    }
  }, []); // stable — no external deps, uses refs

  // ── Scheduling: re-schedule after every state update ──────────────────────
  // Every time `matches` changes, we re-evaluate the correct interval and
  // set a new one-shot timer. This means the interval adapts dynamically:
  // scheduled → live (20 s), live → halftime (35 s), etc.
  useEffect(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    const delay = pickInterval(matches);
    pollTimerRef.current = setTimeout(doFetch, delay);
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [matches, doFetch]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current)  clearTimeout(pollTimerRef.current);
      if (driftTimerRef.current) clearTimeout(driftTimerRef.current);
      abortCtrlRef.current?.abort(); // cancel any pending in-flight request
    };
  }, []);

  return { matches, lastUpdated, isPending };
}
