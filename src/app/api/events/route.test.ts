import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  backup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/lib/backup", () => ({ createCaseBackupBestEffort: mocks.backup }));

import { POST } from "./route";

describe("event creation tags", () => {
  it("creates multiple validated assignments in the event transaction", async () => {
    const create = vi.fn(async ({ data }) => ({
      id: "event-a",
      ...data,
      people: [],
      documents: [],
      tags: [],
      conversation: null,
    }));
    mocks.prisma = {
      case: { findFirst: vi.fn().mockResolvedValue({ id: "case-a" }) },
      tag: { count: vi.fn().mockResolvedValue(2) },
      $transaction: vi.fn(async (callback) => callback({
        event: { create },
        auditEntry: { create: vi.fn().mockResolvedValue({}) },
      })),
    };

    const response = await POST(new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        caseId: "case-a",
        title: "Tagged event",
        startDate: "2026-08-27T09:00:00.000Z",
        tagIds: ["tag-a", "tag-b"],
      }),
    }));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tags: { create: [{ tagId: "tag-a" }, { tagId: "tag-b" }] },
      }),
    }));
  });
});
