import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLoginAttempts, loginSource, reserveLoginAttempt } from "./rate-limit";

describe("single-administrator login budget", () => {
  beforeEach(() => clearLoginAttempts("source"));

  it("reserves concurrent attempts and restores the budget after the window", () => {
    for (let n = 0; n < 5; n++) expect(reserveLoginAttempt("source", 1000)).toBe(true);
    expect(reserveLoginAttempt("source", 1000)).toBe(false);
    expect(reserveLoginAttempt("other-source", 1000)).toBe(true);
    expect(reserveLoginAttempt("source", 1000 + 15 * 60 * 1000)).toBe(true);
  });

  it("resets after successful authentication", () => {
    for (let n = 0; n < 5; n++) reserveLoginAttempt("source", 1000);
    clearLoginAttempts("source");
    expect(reserveLoginAttempt("source", 1000)).toBe(true);
  });
  it("accepts a platform-supplied IP only when running on Vercel", () => {
    const request = new Request("https://workspace.example/login", { headers: {
      "x-forwarded-for": "192.0.2.10", "x-vercel-forwarded-for": "192.0.2.11",
    }});
    vi.stubEnv("VERCEL", "");
    expect(loginSource(request)).toBe("shared");
    vi.stubEnv("VERCEL", "1");
    expect(loginSource(request)).toBe("192.0.2.11");
  });

});
