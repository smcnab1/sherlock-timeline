export const SESSION_COOKIE_NAME = "sherlock_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  sub: "admin";
  iat: number;
  exp: number;
};

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

const encoder = new TextEncoder();

export function getSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function getExpiredSessionCookieOptions(): CookieOptions & {
  expires: Date;
} {
  return {
    ...getSessionCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  };
}

export async function createSessionToken(now = Math.floor(Date.now() / 1000)) {
  const payload: SessionPayload = {
    sub: "admin",
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(payloadPart);

  return `${payloadPart}.${signature}`;
}

export async function verifySessionToken(token: string | undefined) {
  if (!token) return false;

  const [payloadPart, signaturePart, extraPart] = token.split(".");
  if (!payloadPart || !signaturePart || extraPart !== undefined) return false;

  try {
    const expectedSignature = await sign(payloadPart);
    if (!constantTimeEqual(signaturePart, expectedSignature)) return false;

    const payload = JSON.parse(
      base64UrlDecodeToString(payloadPart),
    ) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);

    return (
      payload.sub === "admin" &&
      typeof payload.exp === "number" &&
      payload.exp > now
    );
  } catch {
    return false;
  }
}

export function sessionTokenFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    const name = cookie.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = cookie.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export async function isAuthenticatedRequest(request: Request) {
  return verifySessionToken(sessionTokenFromRequest(request));
}

async function sign(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array) {
  let value = "";
  bytes.forEach((byte) => {
    value += String.fromCharCode(byte);
  });

  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function base64UrlDecodeToString(value: string) {
  return new TextDecoder().decode(base64UrlDecode(value));
}

function constantTimeEqual(a: string, b: string) {
  const left = base64UrlDecode(a);
  const right = base64UrlDecode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
}
