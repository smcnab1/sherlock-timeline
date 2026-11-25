import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createEvidenceStorageKey } from "@/lib/evidence-policy";
import type { EvidenceStorage } from "@/lib/runtime-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectFinaliseHandler } from "./route";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", crypto.randomUUID());
});

const caseId = "case_12345678";
const upload = {
  caseId,
  eventIds: [],
  tagIds: [],
  personId: "",
  title: "Case archive",
  description: "Uploaded evidence",
  sourceType: "Other",
  sourceReference: "",
  confidenceLevel: "Documented",
  documentId: "7ee5e1e0-03c2-4a82-a8ce-2381c6a9e1cf",
  objectId: "8d6c8ef0-1d04-4fc7-a2b9-8cb3d1bc9b44",
  filename: "case-material.zip",
  contentType: "application/zip",
  size: 3,
};
const pathname = createEvidenceStorageKey(
  caseId,
  upload.documentId,
  upload.filename,
  upload.objectId,
);
const blobUrl = `https://store.private.blob.vercel-storage.com/${pathname}`;

describe("direct ZIP evidence finalisation", () => {
  it("records the original filename, actual size and MIME type after streaming integrity hashing", async () => {
    const tx = {
      document: {
        create: vi
          .fn()
          .mockResolvedValue({
            id: upload.documentId,
            caseId,
            filename: upload.filename,
          }),
      },
      auditEntry: { create: vi.fn().mockResolvedValue({}) },
    };
    const storage = fakeStorage();
    const handler = createDirectFinaliseHandler({
      prisma: fakePrisma(tx) as never,
      storage,
      backup: vi.fn().mockResolvedValue(null),
    });

    const response = await handler(await authenticatedRequest());

    expect(response.status).toBe(201);
    expect(tx.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          filename: "case-material.zip",
          fileSize: 3,
          mimeType: "application/zip",
          contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  it("retains the direct-upload Blob when final database persistence fails", async () => {
    const storage = fakeStorage();
    const handler = createDirectFinaliseHandler({
      prisma: fakePrisma(
        null,
        vi.fn().mockRejectedValue(new Error("database unavailable")),
      ) as never,
      storage,
      backup: vi.fn().mockResolvedValue(null),
    });

    const response = await handler(await authenticatedRequest());

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("DATABASE_FAILURE");
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("returns the accepted evidence after a concurrent finalisation or retry", async () => {
    const storage = fakeStorage();
    const prisma = fakePrisma(null, vi.fn().mockRejectedValue(new Error("conflict")));
    const existing = {
      id: upload.documentId,
      filePath: "vercel-blob:" + blobUrl,
      contentHash: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      deletedAt: null,
    };
    prisma.document.findFirst.mockResolvedValue(existing);
    const backup = vi.fn();
    const handler = createDirectFinaliseHandler({ prisma: prisma as never, storage, backup });
    const response = await handler(await authenticatedRequest());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(existing);
    expect(prisma.document.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: upload.documentId, caseId, filePath: "vercel-blob:" + blobUrl },
    }));
    expect(storage.delete).not.toHaveBeenCalled();
    expect(backup).not.toHaveBeenCalled();
  });

  it("never deletes a caller-supplied object after a size mismatch", async () => {
    const storage = fakeStorage();
    const handler = createDirectFinaliseHandler({ prisma: fakePrisma(null) as never, storage });
    const response = await handler(await authenticatedRequest({ ...upload, size: 123 }));
    expect(response.status).toBe(400);
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

function fakeStorage(): EvidenceStorage {
  return {
    kind: "vercel-blob",
    put: vi.fn(),
    get: vi.fn().mockResolvedValue({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      contentType: "application/zip",
      size: 3,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
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
    person: { findFirst: vi.fn() },
    tag: { count: vi.fn().mockResolvedValue(0) },
    $transaction: transaction,
  };
}

async function authenticatedRequest(metadata = upload) {
  const token = await createSessionToken();
  return new Request("http://localhost/api/upload/finalise", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({ upload: metadata, blobUrl }),
  });
}
