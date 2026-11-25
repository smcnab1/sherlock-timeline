import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEvidenceStorageKey } from "@/lib/evidence-policy";
import {
  blobConfiguration,
  createRuntimeEvidenceStorage,
  createRuntimeEvidenceStorageForLocator,
  StorageError,
} from "@/lib/runtime-storage";

describe("runtime evidence storage", () => {
  it("uses private Vercel Blob operations with a supported read-write token", async () => {
    const body = Buffer.from("durable evidence");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });
    const blobClient = {
      put: vi.fn().mockResolvedValue({
        url: "https://store.private.blob.vercel-storage.com/evidence/file.txt",
      }),
      get: vi.fn().mockResolvedValue({
        statusCode: 200,
        stream,
        blob: { contentType: "text/plain", size: body.length },
      }),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const storage = createRuntimeEvidenceStorage({
      env: {
        NODE_ENV: "production",
        VERCEL: "1",
        BLOB_READ_WRITE_TOKEN: "configured",
      },
      blobClient,
    });

    const stored = await storage.put({
      key: "evidence/case/document/file.txt",
      body,
      contentType: "text/plain",
    });
    const downloaded = await storage.get(stored.locator);

    expect(storage.kind).toBe("vercel-blob");
    expect(stored.locator).toMatch(
      /^vercel-blob:https:\/\/store\.private\.blob\.vercel-storage\.com\//,
    );
    expect(blobClient.put).toHaveBeenCalledWith(
      "evidence/case/document/file.txt",
      body,
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
      }),
    );
    expect(blobClient.get).toHaveBeenCalledWith(expect.any(String), {
      access: "private",
    });
    expect(
      Buffer.from(await new Response(downloaded.stream).arrayBuffer()),
    ).toEqual(body);
  });

  it("recognises the installed SDK's supported OIDC store configuration on Vercel", () => {
    expect(
      blobConfiguration({ VERCEL: "1", BLOB_STORE_ID: "store_test" }),
    ).toMatchObject({
      configured: true,
      method: "oidc",
    });
    expect(blobConfiguration({ VERCEL_OIDC_TOKEN: "token" })).toMatchObject({
      configured: false,
      partial: true,
    });
  });

  it("refuses production storage when Blob is unconfigured", () => {
    expect(() =>
      createRuntimeEvidenceStorage({
        env: { NODE_ENV: "production", VERCEL: "1" },
      }),
    ).toThrowError(expect.objectContaining({ code: "STORAGE_NOT_CONFIGURED" }));
  });

  it("uses a filesystem fallback outside production and Vercel", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "sherlock-storage-test-"),
    );
    const storage = createRuntimeEvidenceStorage({
      env: { NODE_ENV: "test" },
      localRoot: root,
    });
    const body = Buffer.from("local evidence");
    const stored = await storage.put({
      key: "evidence/case/document/file.txt",
      body,
      contentType: "text/plain",
    });

    expect(storage.kind).toBe("local-filesystem");
    expect(await readFile(stored.locator)).toEqual(body);
    const downloaded = await storage.get(stored.locator);
    expect(
      Buffer.from(await new Response(downloaded.stream).arrayBuffer()),
    ).toEqual(body);
  });

  it("does not treat historical production filesystem paths as durable objects", () => {
    expect(() =>
      createRuntimeEvidenceStorageForLocator("/tmp/sherlock/uploads/lost.pdf", {
        env: {
          NODE_ENV: "production",
          VERCEL: "1",
          BLOB_READ_WRITE_TOKEN: "configured",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "STORED_OBJECT_MISSING" }));
  });

  it("rejects traversal in storage keys and locators", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "sherlock-storage-test-"),
    );
    const storage = createRuntimeEvidenceStorage({
      env: { NODE_ENV: "test" },
      localRoot: root,
    });
    await expect(
      storage.put({
        key: "../escape.txt",
        body: Buffer.from("x"),
        contentType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(StorageError);
    await expect(
      storage.get(path.join(root, "..", "escape.txt")),
    ).rejects.toMatchObject({ code: "INVALID_STORAGE_PATH" });
  });

  it("generates unique, predictable and filename-safe storage keys", () => {
    const first = createEvidenceStorageKey(
      "case_12345678",
      "document_12345678",
      "../../unsafe report.pdf",
    );
    const second = createEvidenceStorageKey(
      "case_12345678",
      "document_12345678",
      "../../unsafe report.pdf",
    );

    expect(first).toMatch(
      /^evidence\/case_12345678\/document_12345678\/[0-9a-f-]+-unsafe-report\.pdf$/,
    );
    expect(second).not.toBe(first);
    expect(first).not.toContain("..");
  });
});
