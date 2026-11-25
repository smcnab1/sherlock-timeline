import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  evidenceApiErrorMessage,
  uploadNetworkErrorMessage,
} from "@/lib/evidence-errors";
import { downloadEvidence } from "@/lib/evidence-download";
import {
  createRuntimeEvidenceStorage,
  createRuntimeEvidenceStorageForLocator,
  StorageError,
  type EvidenceStorage,
} from "@/lib/runtime-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("evidence downloads", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-session-secret-with-at-least-32-bytes");
  });

  it("rejects unauthenticated downloads", async () => {
    await expect(
      downloadEvidence(
        new Request("http://localhost/download"),
        "document_12345678",
        dependencies() as never,
      ),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 });
  });

  it("distinguishes missing evidence metadata", async () => {
    const deps = dependencies();
    deps.prisma.document.findFirst.mockResolvedValue(null);
    await expect(
      downloadEvidence(
        await authenticatedRequest(),
        "document_12345678",
        deps as never,
      ),
    ).rejects.toMatchObject({
      code: "EVIDENCE_NOT_FOUND",
      status: 404,
    });
  });

  it("rejects evidence whose case is unavailable", async () => {
    const deps = dependencies();
    deps.prisma.case.findFirst.mockResolvedValue(null);
    await expect(
      downloadEvidence(
        await authenticatedRequest(),
        "document_12345678",
        deps as never,
      ),
    ).rejects.toMatchObject({
      code: "CASE_ACCESS_DENIED",
      status: 403,
    });
  });

  it.each([
    ["STORED_OBJECT_MISSING", "STORED_OBJECT_MISSING", 404],
    ["STORAGE_NOT_CONFIGURED", "STORAGE_NOT_CONFIGURED", 503],
    ["STORAGE_AUTHENTICATION_FAILED", "STORAGE_AUTHENTICATION_FAILED", 503],
    ["STORAGE_PROVIDER_FAILURE", "STORAGE_PROVIDER_FAILURE", 502],
  ] as const)(
    "maps %s storage failures without exposing provider details",
    async (storageCode, apiCode, status) => {
      const deps = dependencies(
        new StorageError(storageCode, "secret provider detail"),
      );
      await expect(
        downloadEvidence(
          await authenticatedRequest(),
          "document_12345678",
          deps as never,
        ),
      ).rejects.toMatchObject({
        code: apiCode,
        status,
      });
    },
  );

  it("streams a private object with the stored MIME type and safe download filename", async () => {
    const bytes = Buffer.from("matching bytes");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const deps = dependencies();
    deps.storage.get.mockResolvedValue({
      stream,
      contentType: "application/pdf",
      size: bytes.length,
    });

    const response = await downloadEvidence(
      await authenticatedRequest(),
      "document_12345678",
      deps as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(
      'filename="Original report.pdf"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("downloads a local-development file through a fresh storage instance", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "sherlock-download-test-"),
    );
    const bytes = Buffer.from("local bytes survive a fresh instance");
    const writer = createRuntimeEvidenceStorage({
      env: { NODE_ENV: "test" },
      localRoot: root,
    });
    const stored = await writer.put({
      key: "evidence/case/document/local.txt",
      body: bytes,
      contentType: "text/plain",
    });
    const deps = dependencies();
    deps.prisma.document.findFirst.mockResolvedValue({
      id: "document_12345678",
      caseId: "case_12345678",
      filename: "local.txt",
      filePath: stored.locator,
      fileSize: bytes.length,
      mimeType: "text/plain",
    });
    const localDependencies = {
      prisma: deps.prisma,
      storageForLocator: (locator: string) =>
        createRuntimeEvidenceStorageForLocator(locator, {
          env: { NODE_ENV: "test" },
          localRoot: root,
        }),
    };

    const response = await downloadEvidence(
      await authenticatedRequest(),
      "document_12345678",
      localDependencies as never,
    );

    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});

describe("upload UI error parsing", () => {
  it("propagates a structured API error message", async () => {
    const response = Response.json(
      {
        error: {
          code: "STORAGE_NOT_CONFIGURED",
          message: "Evidence storage is not configured for this deployment.",
        },
      },
      { status: 503 },
    );
    await expect(evidenceApiErrorMessage(response, "fallback")).resolves.toBe(
      "Evidence storage is not configured for this deployment.",
    );
  });

  it("provides actionable messages for platform 413 and interrupted uploads", async () => {
    await expect(
      evidenceApiErrorMessage(
        new Response("too large", { status: 413 }),
        "fallback",
      ),
    ).resolves.toContain("4 MB");
    expect(uploadNetworkErrorMessage(new TypeError("fetch failed"))).toContain(
      "interrupted",
    );
  });
});

function dependencies(storageError?: StorageError) {
  const storage = {
    kind: "vercel-blob" as const,
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  } satisfies EvidenceStorage;
  if (storageError) storage.get.mockRejectedValue(storageError);

  return {
    prisma: {
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: "document_12345678",
          caseId: "case_12345678",
          filename: "Original report.pdf",
          filePath:
            "vercel-blob:https://store.private.blob.vercel-storage.com/file.pdf",
          fileSize: 14,
          mimeType: "application/pdf",
        }),
      },
      case: { findFirst: vi.fn().mockResolvedValue({ id: "case_12345678" }) },
    },
    storage,
    storageForLocator: vi.fn(() => storage),
  };
}

async function authenticatedRequest() {
  const token = await createSessionToken();
  return new Request("http://localhost/download", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}
