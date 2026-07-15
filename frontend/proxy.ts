import { NextRequest, NextResponse } from "next/server";

const AUTH_PAGES = new Set(["/login", "/register"]);

// Stays public regardless of login state — e.g. an accessibility statement is
// customarily expected to be reachable without an account.
const PUBLIC_PAGES = new Set(["/accessibility"]);

// Cheap, cookie-presence-only check — no backend call here (Next's own docs warn
// against slow/DB checks in Proxy). Real verification happens per-page via
// lib/session.ts and, ultimately, in FastAPI on every gated API call.
//
// Deliberately does NOT bounce logged-in-looking visitors away from /login —
// cookie *presence* isn't the same as a *valid* session (idle timeout can
// expire the session server-side while the 24h cookie is still sitting in the
// browser). Redirecting away from /login based on presence alone created a
// loop: an expired session sends /admin -> /login, and /login would send it
// straight back to / -> /admin again, forever. /login must always be a safe
// landing spot.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (AUTH_PAGES.has(pathname) || PUBLIC_PAGES.has(pathname)) {
    return NextResponse.next();
  }

  if (!request.cookies.has("session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
