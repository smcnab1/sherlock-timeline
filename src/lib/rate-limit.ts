import { isIP } from "node:net";

const windowMs = 15 * 60 * 1000;
const maxAttempts = 5;
const maxSources = 4096;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function loginSource(request: Request) {
  const ip = request.headers.get("x-vercel-forwarded-for")?.trim();
  return process.env.VERCEL === "1" && ip && isIP(ip) ? ip : "shared";
}

export function reserveLoginAttempt(key: string, now = Date.now()) {
  // The map is insertion-ordered. A source keeps its original expiry.
  for (const [source, record] of attempts) {
    if (record.resetAt > now) break;
    attempts.delete(source);
  }
  const record = attempts.get(key);
  if (record) {
    if (record.count >= maxAttempts) return false;
    record.count++;
  } else {
    if (attempts.size >= maxSources) return false;
    attempts.set(key, { count: 1, resetAt: now + windowMs });
  }
  return true;
}

export function clearLoginAttempts(key: string) {
  attempts.delete(key);
}
