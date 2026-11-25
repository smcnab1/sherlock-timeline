import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  backup: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/lib/backup", () => ({ createCaseBackup: mocks.backup }));

import { PATCH, POST } from "./route";

describe("evidence tag assignment access", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-session-secret-with-at-least-32-bytes");
    mocks.backup.mockReset().mockResolvedValue(undefined);
  });

  it("creates a metadata-only evidence item with multiple tags", async () => {
    const create = vi.fn(async ({ data }) => ({
      id: "document-a",
      ...data,
      people: [],
      events: [],
      tags: [],
    }));
    mocks.prisma = {
      case: { findFirst: vi.fn().mockResolvedValue({ id: "case-a" }) },
      event: { count: vi.fn() },
      tag: { count: vi.fn().mockResolvedValue(2) },
      $transaction: vi.fn(async (callback) => callback({
        document: { create },
        auditEntry: { create: vi.fn().mockResolvedValue({}) },
      })),
    };

    const response = await POST(await authenticatedRequest({
      caseId: "case-a",
      title: "Evidence",
      tagIds: ["tag-a", "tag-b"],
    }, "POST"));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tags: { create: [{ tagId: "tag-a" }, { tagId: "tag-b" }] },
      }),
    }));
  });

  it("rejects unauthenticated assignment changes before database work", async () => {
    mocks.prisma = { document: { findFirst: vi.fn() } };
    const response = await PATCH(new Request("http://localhost/api/evidence", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "document-a", tagIds: ["tag-a"] }),
    }));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTHENTICATION_REQUIRED");
    expect((mocks.prisma.document as { findFirst: ReturnType<typeof vi.fn> }).findFirst).not.toHaveBeenCalled();
  });

  it("rejects evidence tags from another case", async () => {
    const transaction = vi.fn();
    mocks.prisma = {
      document: { findFirst: vi.fn().mockResolvedValue(existingEvidence()) },
      case: { findFirst: vi.fn().mockResolvedValue({ id: "case-a" }) },
      event: { count: vi.fn() },
      tag: { count: vi.fn().mockResolvedValue(0) },
      $transaction: transaction,
    };
    const response = await PATCH(await authenticatedRequest({ id: "document-a", tagIds: ["tag-other-case"] }));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CASE_ACCESS_DENIED");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("replaces multiple evidence tags in the metadata transaction", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const updated = {
      id: "document-a",
      caseId: "case-a",
      title: "Evidence",
      filename: "evidence.pdf",
      tags: [],
      people: [],
      events: [],
    };
    mocks.prisma = {
      document: { findFirst: vi.fn().mockResolvedValue(existingEvidence()) },
      case: { findFirst: vi.fn().mockResolvedValue({ id: "case-a" }) },
      event: { count: vi.fn() },
      tag: { count: vi.fn().mockResolvedValue(2) },
      $transaction: vi.fn(async (callback) => callback({
        document: {
          update: vi.fn().mockResolvedValue({}),
          findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
        },
        eventDocument: { deleteMany: vi.fn(), createMany: vi.fn() },
        documentTag: { deleteMany, createMany },
        evidencePerson: { deleteMany: vi.fn(), create: vi.fn() },
        auditEntry: { create: auditCreate },
      })),
    };

    const response = await PATCH(await authenticatedRequest({ id: "document-a", tagIds: ["tag-b", "tag-c"] }));

    expect(response.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({ where: { documentId: "document-a" } });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { documentId: "document-a", tagId: "tag-b" },
        { documentId: "document-a", tagId: "tag-c" },
      ],
    });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "update-tags" }),
    }));
  });
});

function existingEvidence() {
  return {
    id: "document-a",
    caseId: "case-a",
    title: "Evidence",
    filename: "evidence.pdf",
    tags: [{ tagId: "tag-a" }],
  };
}

async function authenticatedRequest(body: unknown, method = "PATCH") {
  const token = await createSessionToken();
  return new Request("http://localhost/api/evidence", {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify(body),
  });
}
