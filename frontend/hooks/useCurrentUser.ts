"use client";
import { useEffect, useState } from "react";

export interface CurrentUser {
  id: string;
  email: string;
  role: "user" | "admin";
}

/** Same shape as useRequireAuth but never redirects — for UI that just wants to know who's logged in. */
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { user, loading };
}
