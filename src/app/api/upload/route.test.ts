import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { MAX_EVIDENCE_FILE_BYTES } from "@/lib/evidence-policy";
import type { EvidenceStorage } from "@/lib/runtime-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUploadHandler } from "./route";

const caseId = "case_12345678";

describe("evidence upload route", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-session-secret-with-at-least-32-bytes");
  });

  it("uploads to storage before committing the document and audit transaction", async () => {
    const order: string[] = [];
    const storage = fakeStorage({
      put: vi.fn(async () => {
        order.push("blob");
        return {
          locator:
            "vercel-blob:https://store.private.blob.vercel-storage.com/file.pdf",
          provider: "vercel-blob" as const,
          size: 3,
        };
      }),
    });
    const document = { id: "document_12345678", caseId, filename: "proof.pdf" };
    const tx = {
      document: {
        create: vi.fn(async () => {
          order.push("document");
          return document;
        }),
      },
      auditEntry: {
        create: vi.fn(async () => {
          order.push("audit");
          return {};
        }),
      },
    };
    const prisma = fakePrisma(tx);
    const handler = createUploadHandler({
      prisma: prisma as never,
      storage,
      backup: vi.fn().mockResolvedValue(null),
    });

    const response = await handler(
      await uploadRequest(
        new File(["pdf"], "proof.pdf", { type: "application/pdf" }),
      ),
    );

    expect(response.status).toBe(201);
    expect(order).toEqual(["blob", "document", "audit"]);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(tx.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caseId,
          filename: "proof.pdf",
          filePath: expect.stringMatching(/^vercel-blob:/),
          fileSize: 3,
          contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  it("deletes the uploaded Blob when the database transaction fails", async () => {
    const storage = fakeStorage();
    const prisma = fakePrisma(
      null,
      vi.fn().mockRejectedValue(new Error("database unavailable")),
    );
    const handler = createUploadHandler({
      prisma: prisma as never,
      storage,
      backup: vi.fn().mockResolvedValue(null),
    });

    const response = await handler(
      await uploadRequest(
        new File(["pdf"], "proof.pdf", { type: "application/pdf" }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("DATABASE_FAILURE");
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^vercel-blob:/),
    );
  });

  it("rejects unauthenticated uploads before storage or database work", async () => {
    const storage = fakeStorage();
    const handler = createUploadHandler({
      prisma: fakePrisma(null) as never,
      storage,
      backup: vi.fn().mockResolvedValue(null),
    });
    const form = new FormData();
    form.set("caseId", caseId);
    form.set(
      "file",
      new File(["pdf"], "proof.pdf", { type: "application/pdf" }),
    );

    const response = await handler(
      new Request("http://localhost/api/upload", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(storage.put).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null, "INVALID_REQUEST", 400],
    [
      "empty",
      new File([], "empty.pdf", { type: "application/pdf" }),
      "EMPTY_FILE",
      400,
    ],
    [
      "unsupported",
      new File(["x"], "malware.exe", { type: "application/octet-stream" }),
      "UNSUPPORTED_FILE",
      400,
    ],
    [
      "mismatched",
      new File(["x"], "proof.pdf", { type: "text/html" }),
      "UNSUPPORTED_FILE",
      400,
    ],
  ])(
    "rejects %s files with a structured error",
    async (_label, file, code, status) => {
      const storage = fakeStorage();
      const handler = createUploadHandler({
        prisma: fakePrisma(null) as never,
        storage,
        backup: vi.fn().mockResolvedValue(null),
      });
      const response = await handler(await uploadRequest(file));

      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
      expect(storage.put).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized files with a structured 413", async () => {
    const file = new File(
      [new Uint8Array(MAX_EVIDENCE_FILE_BYTES + 1)],
      "large.pdf",
      { type: "application/pdf" },
    );
    const handler = createUploadHandler({
      prisma: fakePrisma(null) as never,
      storage: fakeStorage(),
      backup: vi.fn().mockResolvedValue(null),
    });
    const response = await handler(await uploadRequest(file));

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects event references from another case", async () => {
    const storage = fakeStorage();
    const prisma = fakePrisma(null);
    prisma.event.count.mockResolvedValue(0);
    const handler = createUploadHandler({
      prisma: prisma as never,
      storage,
      backup: vi.fn().mockResolvedValue(null),
    });
    const response = await handler(
      await uploadRequest(
        new File(["pdf"], "proof.pdf", { type: "application/pdf" }),
        { eventIds: ["event_other_case"] },
      ),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CASE_ACCESS_DENIED");
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("creates multiple case-scoped evidence tag assignments", async () => {
    const tx = {
      document: {
        create: vi.fn().mockResolvedValue({ id: "document_12345678", caseId, title: "proof.pdf", filename: "proof.pdf" }),
      },
      auditEntry: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = fakePrisma(tx);
    prisma.tag.count.mockResolvedValue(2);
    const handler = createUploadHandler({
      prisma: prisma as never,
      storage: fakeStorage(),
      backup: vi.fn().mockResolvedValue(null),
    });

    const response = await handler(await uploadRequest(
      new File(["pdf"], "proof.pdf", { type: "application/pdf" }),
      { tagIds: ["tag-a", "tag-b"] },
    ));

    expect(response.status).toBe(201);
    expect(tx.document.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tags: { create: [{ tagId: "tag-a" }, { tagId: "tag-b" }] },
      }),
    }));
  });

  it("refuses production uploads when Blob is unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const handler = createUploadHandler({
      prisma: fakePrisma(null) as never,
      backup: vi.fn().mockResolvedValue(null),
    });
    const response = await handler(
      await uploadRequest(
        new File(["pdf"], "proof.pdf", { type: "application/pdf" }),
      ),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("STORAGE_NOT_CONFIGURED");
  });
});

function fakeStorage(
  overrides: Partial<EvidenceStorage> = {},
): EvidenceStorage {
  return {
    kind: "vercel-blob",
    put: vi.fn().mockResolvedValue({
      locator:
        "vercel-blob:https://store.private.blob.vercel-storage.com/file.pdf",
      provider: "vercel-blob",
      size: 3,
    }),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakePrisma(
  tx: unknown,
  transaction = vi.fn(async (callback: (value: unknown) => unknown) =>
    callback(tx),
  ),
) {
  return {
    document: { findFirst: vi.fn().mockResolvedValue(null) },
    case: { findFirst: vi.fn().mockResolvedValue({ id: caseId }) },
    event: { count: vi.fn().mockResolvedValue(0) },
    person: { findFirst: vi.fn().mockResolvedValue({ id: "person_12345678" }) },
    tag: { count: vi.fn().mockResolvedValue(0) },
    $transaction: transaction,
  };
}

async function uploadRequest(
  file: File | null,
  options: { eventIds?: string[]; tagIds?: string[] } = {},
) {
  const form = new FormData();
  form.set("caseId", caseId);
  if (file) form.set("file", file);
  options.eventIds?.forEach((eventId) => form.append("eventIds", eventId));
  options.tagIds?.forEach((tagId) => form.append("tagIds", tagId));
  const token = await createSessionToken();
  return new Request("http://localhost/api/upload", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    body: form,
  });
}
