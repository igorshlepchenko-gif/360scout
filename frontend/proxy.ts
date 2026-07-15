import { NextRequest, NextResponse } from "next/server";

const AUTH_PAGES = new Set(["/login", "/register"]);

// Stays public regardless of login state — e.g. an accessibility statement is
// customarily expected to be reachable without an account.
const PUBLIC_PAGES = new Set(["/accessibility"]);

// Cheap, cookie-presence-only check — no backend call here (Next's own docs warn
// against slow/DB checks in Proxy). Real verification happens per-page via
// lib/session.ts and, ultimately, in FastAPI on every gated API call.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("session");

  if (AUTH_PAGES.has(pathname)) {
    if (hasSession) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (PUBLIC_PAGES.has(pathname)) {
    return NextResponse.next();
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
