import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  backup: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/lib/backup", () => ({ createCaseBackupBestEffort: mocks.backup }));

import { POST } from "./route";
import { DELETE } from "./[tagId]/route";

describe("tag routes", () => {
  beforeEach(() => {
    mocks.backup.mockReset().mockResolvedValue(undefined);
  });

  it("creates a normalised case-scoped tag with one audit entry", async () => {
    const auditEntry = { create: vi.fn().mockResolvedValue({}) };
    const tag = {
      create: vi.fn(async ({ data }) => ({ id: "tag-a", ...data, _count: { events: 0, documents: 0 } })),
    };
    mocks.prisma = {
      case: { findFirst: vi.fn().mockResolvedValue({ id: "case-a" }) },
      $transaction: vi.fn(async (callback) => callback({ tag, auditEntry })),
    };

    const response = await POST(new Request("http://localhost/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: "case-a", name: "  Unanswered   Emails ", colour: "#38BDF8" }),
    }));

    expect(response.status).toBe(201);
    expect(tag.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        caseId: "case-a",
        name: "Unanswered Emails",
        normalizedName: "unanswered emails",
        colour: "#38bdf8",
      },
    }));
    expect(auditEntry.create).toHaveBeenCalledTimes(1);
    expect(mocks.backup).toHaveBeenCalledWith(expect.anything(), "case-a", "tag-create", { tagId: "tag-a" });
  });

  it("deletes only the tag and its cascading assignments", async () => {
    const tagDelete = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    mocks.prisma = {
      tag: {
        findFirst: vi.fn().mockResolvedValue({
          id: "tag-a",
          caseId: "case-a",
          name: "Policy",
          colour: "#38bdf8",
          _count: { events: 2, documents: 1 },
        }),
      },
      eventTag: { count: vi.fn().mockResolvedValue(2) },
      documentTag: { count: vi.fn().mockResolvedValue(1) },
      $transaction: vi.fn(async (callback) => callback({
        tag: { delete: tagDelete },
        auditEntry: { create: auditCreate },
      })),
    };

    const response = await DELETE(
      new Request("http://localhost/api/tags/tag-a?caseId=case-a", { method: "DELETE" }),
      { params: Promise.resolve({ tagId: "tag-a" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, tagId: "tag-a", assignmentsRemoved: 3 });
    expect(tagDelete).toHaveBeenCalledWith({ where: { id: "tag-a" } });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });
});
