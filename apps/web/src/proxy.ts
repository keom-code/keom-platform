import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/jwt";

export const config = {
  matcher: ["/seller/:path*", "/admin/:path*"],
};

/**
 * Boundary auth gate — UX only, not real authorization. See
 * docs/ARCHITECTURE.md Section I: every layout also re-verifies the session
 * (defense in depth), and once apps/api is real it must independently re-check
 * role on every call regardless of what this proxy allowed through.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") && session.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/seller/alerts", request.url));
  }

  if (pathname.startsWith("/seller") && session.role !== "SELLER") {
    return NextResponse.redirect(new URL("/admin/reports", request.url));
  }

  return NextResponse.next();
}
