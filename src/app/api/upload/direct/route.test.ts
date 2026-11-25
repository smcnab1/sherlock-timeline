import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  createEvidenceStorageKey,
  MAX_ZIP_EVIDENCE_FILE_BYTES,
} from "@/lib/evidence-policy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectUploadHandler } from "./route";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", crypto.randomUUID());
});

const caseId = "case_12345678";
const upload = {
  caseId,
  eventIds: [] as string[],
  tagIds: [] as string[],
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
  size: MAX_ZIP_EVIDENCE_FILE_BYTES,
};

describe("direct ZIP evidence upload authorisation", () => {
  it("does not issue upload permission to unauthenticated users", async () => {
    const issueToken = vi.fn();
    const handler = createDirectUploadHandler({
      prisma: fakePrisma() as never,
      issueToken: issueToken as never,
      presign: fakePresign as never,
    });

    const response = await handler(requestFor(upload));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(issueToken).not.toHaveBeenCalled();
  });

  it("issues a short-lived, private multipart permission scoped to the ZIP object", async () => {
    const issueToken = vi.fn().mockResolvedValue({
      delegationToken: "delegation",
      clientSigningToken: "signing",
      validUntil: Date.now() + 60_000,
    });
    const presign = vi.fn(fakePresign);
    const handler = createDirectUploadHandler({
      prisma: fakePrisma() as never,
      issueToken: issueToken as never,
      presign: presign as never,
    });

    const response = await handler(await authenticatedRequest(upload));

    expect(response.status).toBe(200);
    expect(issueToken).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: createEvidenceStorageKey(
          caseId,
          upload.documentId,
          "case-material.zip",
          upload.objectId,
        ),
        operations: ["put"],
        allowedContentTypes: ["application/zip"],
        maximumSizeInBytes: 500_000_000,
      }),
    );
    expect(presign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: "put",
        access: "private",
        pathname: createEvidenceStorageKey(
          caseId,
          upload.documentId,
          "case-material.zip",
          upload.objectId,
        ),
        allowedContentTypes: ["application/zip"],
        maximumSizeInBytes: 500_000_000,
        addRandomSuffix: false,
        allowOverwrite: false,
      }),
    );
  });

  it("rejects cross-case references before a token is issued", async () => {
    const issueToken = vi.fn();
    const prisma = fakePrisma();
    prisma.event.count.mockResolvedValue(0);
    const handler = createDirectUploadHandler({
      prisma: prisma as never,
      issueToken: issueToken as never,
      presign: fakePresign as never,
    });

    const response = await handler(
      await authenticatedRequest({ ...upload, eventIds: ["event_other_case"] }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CASE_ACCESS_DENIED");
    expect(issueToken).not.toHaveBeenCalled();
  });
});

async function fakePresign() {
  return {
    presignedUrl:
      "https://blob.vercel-storage.com/?vercel-blob-delegation=delegation&vercel-blob-signature=signature",
  };
}

function fakePrisma() {
  return {
    case: { findFirst: vi.fn().mockResolvedValue({ id: caseId }) },
    event: { count: vi.fn().mockResolvedValue(0) },
    person: { findFirst: vi.fn() },
    tag: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(),
  };
}

function requestFor(payload: typeof upload) {
  const pathname = createEvidenceStorageKey(
    payload.caseId,
    payload.documentId,
    payload.filename,
    payload.objectId,
  );
  return new Request("http://localhost/api/upload/direct", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-presigned-url",
      payload: {
        pathname,
        clientPayload: JSON.stringify(payload),
        multipart: true,
      },
    }),
  });
}

async function authenticatedRequest(payload: typeof upload) {
  const token = await createSessionToken();
  const pathname = createEvidenceStorageKey(
    payload.caseId,
    payload.documentId,
    payload.filename,
    payload.objectId,
  );
  return new Request("http://localhost/api/upload/direct", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({
      type: "blob.generate-presigned-url",
      payload: {
        pathname,
        clientPayload: JSON.stringify(payload),
        multipart: true,
      },
    }),
  });
}
