import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (fetchSite === "cross-site" || fetchSite === "same-site")) {
    return NextResponse.json({ error: "Changes must be submitted from this application." }, { status: 403 });
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const isAuthenticated = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (pathname === "/login") {
    return isAuthenticated
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  if (!isAuthenticated) {
    if (pathname.startsWith("/api/") || pathname.startsWith("/uploads/")) {
      return NextResponse.json(
        {
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "Your session has expired. Sign in and try again.",
          },
        },
        { status: 401 },
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/favicon.ico" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/image/")
  );
}

export const config = {
  matcher: "/:path*",
};
