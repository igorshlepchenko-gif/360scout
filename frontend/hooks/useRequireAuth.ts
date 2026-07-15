"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-page auth guard — covers the "cookie present but session expired"
 * case (proxy.ts already redirects the fully-logged-out case before this
 * page even loads). A brief flash of stale/empty UI is possible while this
 * check is in flight; the real enforcement is the gated backend API calls.
 */
export function useRequireAuth() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(res => {
        if (!cancelled && !res.ok) router.replace("/login");
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => { cancelled = true; };
  }, [router]);
}
