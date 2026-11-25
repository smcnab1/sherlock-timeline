import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  getSessionCookieOptions,
} from "@/lib/auth";
import { clearLoginAttempts, loginSource, reserveLoginAttempt } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const key = loginSource(request);
  if (!reserveLoginAttempt(key)) {
    return NextResponse.json({ error: "Authentication failed" }, { status: 429 });
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return failed();
  }

  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!passwordHash) {
    return NextResponse.json({ error: "Authentication is not configured" }, { status: 500 });
  }

  let isValid = false;
  try {
    isValid = await bcrypt.compare(password, passwordHash);
  } catch {
    isValid = false;
  }

  if (!isValid) {
    return failed();
  }

  clearLoginAttempts(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(), getSessionCookieOptions());

  return response;
}

function failed() {
  return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
}
