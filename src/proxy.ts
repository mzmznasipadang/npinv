import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

// Runs before every page and server action, so nothing behind it is reachable signed out.
export function proxy(request: NextRequest) {
  // Mobile handlers independently verify revocable bearer sessions and return JSON errors.
  if (request.nextUrl.pathname === "/api/v1" || request.nextUrl.pathname.startsWith("/api/v1/")) {
    if (new URL(request.url).searchParams.has("__proto__")) {
      return NextResponse.json({ message: "Invalid request fields or filters." }, { status: 400, headers: { "cache-control": "private, no-store" } });
    }
    return NextResponse.next();
  }
  if (verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Static assets and the login page itself stay public.
  matcher: ["/((?!login|_next/|favicon.ico|icon.png|apple-icon.png).*)"],
};
