import type { PrismaClient } from "@prisma/client";
import { isAuthenticatedRequest } from "@/lib/auth";
import { EvidenceApiError } from "@/lib/evidence-errors";
import { getPrisma } from "@/lib/prisma";
import {
  createRuntimeEvidenceStorageForLocator,
  StorageError,
  type EvidenceStorage,
} from "@/lib/runtime-storage";

type DownloadPrisma = Pick<PrismaClient, "document" | "case">;

type DownloadDependencies = {
  prisma: DownloadPrisma;
  storageForLocator: (locator: string) => EvidenceStorage;
};

export async function downloadEvidence(
  request: Request,
  documentId: string,
  dependencies: DownloadDependencies,
) {
  await requireEvidenceAuthentication(request);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(documentId)) {
    throw new EvidenceApiError(
      "EVIDENCE_NOT_FOUND",
      404,
      "No evidence metadata exists for this document.",
    );
  }

  const document = await dependencies.prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: {
      id: true,
      caseId: true,
      filename: true,
      filePath: true,
      fileSize: true,
      mimeType: true,
    },
  });
  if (!document) {
    throw new EvidenceApiError(
      "EVIDENCE_NOT_FOUND",
      404,
      "No evidence metadata exists for this document.",
    );
  }
  if (!document.caseId) {
    throw new EvidenceApiError(
      "CASE_ACCESS_DENIED",
      403,
      "This evidence is not attached to an accessible case.",
    );
  }

  const targetCase = await dependencies.prisma.case.findFirst({
    where: { id: document.caseId, deletedAt: null },
    select: { id: true },
  });
  if (!targetCase) {
    throw new EvidenceApiError(
      "CASE_ACCESS_DENIED",
      403,
      "You do not have access to the case containing this evidence.",
    );
  }
  if (!document.filePath) {
    throw new EvidenceApiError(
      "STORED_OBJECT_MISSING",
      404,
      "Evidence metadata exists, but no stored file is attached.",
    );
  }

  try {
    const storage = dependencies.storageForLocator(document.filePath);
    const stored = await storage.get(document.filePath);
    const contentType =
      stored.contentType || document.mimeType || "application/octet-stream";
    return new Response(stored.stream, {
      status: 200,
      headers: evidenceDownloadHeaders(
        document.filename,
        contentType,
        stored.size || document.fileSize,
      ),
    });
  } catch (error) {
    throw mapDownloadStorageError(error);
  }
}

export function defaultDownloadDependencies(): DownloadDependencies {
  return {
    prisma: getPrisma(),
    storageForLocator: (locator) =>
      createRuntimeEvidenceStorageForLocator(locator),
  };
}

export async function requireEvidenceAuthentication(request: Request) {
  try {
    if (!(await isAuthenticatedRequest(request))) {
      throw new EvidenceApiError(
        "AUTHENTICATION_REQUIRED",
        401,
        "Your session has expired. Sign in and try again.",
      );
    }
  } catch (error) {
    if (error instanceof EvidenceApiError) throw error;
    throw new EvidenceApiError(
      "AUTHENTICATION_NOT_CONFIGURED",
      503,
      "Authentication is not configured for this deployment.",
      { cause: error },
    );
  }
}

export function evidenceDownloadHeaders(
  filename: string,
  contentType: string,
  size: number,
) {
  const asciiFilename =
    filename
      .replace(/[\r\n\u0000-\u001f\u007f]/g, "")
      .replace(/["\\]/g, "_")
      .replace(/[^\x20-\x7e]/g, "_")
      .slice(0, 180) || "evidence-file";
  const encodedFilename = encodeURIComponent(
    filename.replace(/[\r\n\u0000-\u001f\u007f]/g, ""),
  ).replace(/['()]/g, escapeCharacter);

  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    "Content-Length": String(size),
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
}

function escapeCharacter(value: string) {
  return `%${value.charCodeAt(0).toString(16).toUpperCase()}`;
}

function mapDownloadStorageError(error: unknown) {
  if (!(error instanceof StorageError)) {
    return new EvidenceApiError(
      "STORAGE_PROVIDER_FAILURE",
      502,
      "Evidence storage could not complete the download.",
      { cause: error },
    );
  }

  if (error.code === "STORED_OBJECT_MISSING") {
    return new EvidenceApiError(
      "STORED_OBJECT_MISSING",
      404,
      "Evidence metadata exists, but the stored file is missing.",
      { cause: error },
    );
  }
  if (error.code === "STORAGE_NOT_CONFIGURED") {
    return new EvidenceApiError(
      "STORAGE_NOT_CONFIGURED",
      503,
      "Evidence storage is not configured for this deployment.",
      { cause: error },
    );
  }
  if (error.code === "STORAGE_AUTHENTICATION_FAILED") {
    return new EvidenceApiError(
      "STORAGE_AUTHENTICATION_FAILED",
      503,
      "Evidence storage rejected the deployment credentials.",
      { cause: error },
    );
  }
  return new EvidenceApiError(
    "STORAGE_PROVIDER_FAILURE",
    502,
    "Evidence storage could not complete the download.",
    { cause: error },
  );
}
