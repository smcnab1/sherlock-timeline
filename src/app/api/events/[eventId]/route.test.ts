import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  backup: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/lib/backup", () => ({ createCaseBackupBestEffort: mocks.backup }));

import { PATCH } from "./route";

describe("event tag assignment", () => {
  beforeEach(() => {
    mocks.backup.mockReset().mockResolvedValue(undefined);
  });

  it("replaces multiple assignments atomically and returns the tagged event", async () => {
    const eventTagDelete = vi.fn().mockResolvedValue({ count: 1 });
    const eventTagCreate = vi.fn().mockResolvedValue({ count: 2 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const updated = {
      id: "event-a",
      caseId: "case-a",
      title: "Updated event",
      tags: [{ tag: { id: "tag-b", caseId: "case-a", name: "B", colour: "#38bdf8" } }],
      people: [],
      documents: [],
      conversation: null,
    };
    const transaction = vi.fn(async (callback) => callback({
      event: {
        update: vi.fn().mockResolvedValue({}),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
      },
      eventTag: { deleteMany: eventTagDelete, createMany: eventTagCreate },
      eventPerson: { deleteMany: vi.fn(), createMany: vi.fn() },
      auditEntry: { create: auditCreate },
    }));
    mocks.prisma = {
      event: { findFirst: vi.fn().mockResolvedValue({ id: "event-a", caseId: "case-a", tags: [{ tagId: "tag-a" }] }) },
      tag: { count: vi.fn().mockResolvedValue(2) },
      $transaction: transaction,
    };

    const response = await PATCH(jsonRequest({ title: "Updated event", tagIds: ["tag-b", "tag-c"] }), {
      params: Promise.resolve({ eventId: "event-a" }),
    });

    expect(response.status).toBe(200);
    expect(eventTagDelete).toHaveBeenCalledWith({ where: { eventId: "event-a" } });
    expect(eventTagCreate).toHaveBeenCalledWith({
      data: [
        { eventId: "event-a", tagId: "tag-b" },
        { eventId: "event-a", tagId: "tag-c" },
      ],
    });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "update-tags" }),
    }));
  });

  it("rejects a tag from another case before starting the transaction", async () => {
    const transaction = vi.fn();
    mocks.prisma = {
      event: { findFirst: vi.fn().mockResolvedValue({ id: "event-a", caseId: "case-a", tags: [] }) },
      tag: { count: vi.fn().mockResolvedValue(1) },
      $transaction: transaction,
    };

    const response = await PATCH(jsonRequest({ tagIds: ["tag-a", "tag-other-case"] }), {
      params: Promise.resolve({ eventId: "event-a" }),
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("TAG_CASE_MISMATCH");
    expect(transaction).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/events/event-a", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
