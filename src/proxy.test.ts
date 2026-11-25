import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "./lib/auth";
import { proxy } from "./proxy";

describe("workspace request protection", () => {
  it("rejects a private API request without a session", async () => {
    const result = await proxy(new NextRequest("https://workspace.example/api/cases"));
    expect(result.status).toBe(401);
  });

  it.each(["same-site", "cross-site"])("rejects %s browser writes with a valid cookie", async (site) => {
    vi.stubEnv("SESSION_SECRET", crypto.randomUUID());
    const result = await proxy(new NextRequest("https://workspace.example/api/cases", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${await createSessionToken()}`, "sec-fetch-site": site },
    }));
    expect(result.status).toBe(403);
  });

  it("passes same-origin authenticated writes", async () => {
    vi.stubEnv("SESSION_SECRET", crypto.randomUUID());
    const result = await proxy(new NextRequest("https://workspace.example/api/cases", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${await createSessionToken()}`, "sec-fetch-site": "same-origin" },
    }));
    expect(result.headers.get("x-middleware-next")).toBe("1");
  });
});
