import type { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseDirectEvidenceUpload } from "@/lib/direct-evidence-upload";
import { evidenceErrorResponse } from "@/lib/evidence-error-response";
import { EvidenceApiError } from "@/lib/evidence-errors";
import { requireEvidenceAuthentication } from "@/lib/evidence-download";
import {
  contentHashStream,
  finaliseEvidenceUpload,
  validateEvidenceReferences,
  type UploadPrisma,
} from "@/lib/evidence-upload";
import { getPrisma } from "@/lib/prisma";
import {
  blobPathnameFromLocator,
  createBlobStorageLocator,
  createRuntimeEvidenceStorage,
  type EvidenceStorage,
} from "@/lib/runtime-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FinaliseDependencies = {
  prisma: UploadPrisma;
  storage: EvidenceStorage;
  backup: (
    prisma: PrismaClient,
    caseId: string,
    reason: string,
  ) => Promise<unknown>;
};

export function createDirectFinaliseHandler(
  overrides: Partial<FinaliseDependencies> = {},
) {
  return async function POST(request: Request) {
    try {
      await requireEvidenceAuthentication(request);
      const body = (await request.json()) as {
        upload?: unknown;
        blobUrl?: unknown;
      };
      const input = parseDirectEvidenceUpload(body.upload);
      if (typeof body.blobUrl !== "string") {
        throw new EvidenceApiError(
          "INVALID_REQUEST",
          400,
          "The uploaded Blob reference is invalid.",
        );
      }
      const locator = createBlobStorageLocator(body.blobUrl);
      if (blobPathnameFromLocator(locator) !== input.pathname) {
        throw new EvidenceApiError(
          "INVALID_REQUEST",
          400,
          "The uploaded Blob path is invalid.",
        );
      }

      const prisma = overrides.prisma ?? getPrisma();
      await validateEvidenceReferences(prisma, input);
      const storage = overrides.storage ?? createRuntimeEvidenceStorage();
      if (storage.kind !== "vercel-blob") {
        throw new EvidenceApiError(
          "STORAGE_NOT_CONFIGURED",
          503,
          "Direct ZIP uploads require private Vercel Blob storage.",
        );
      }
      const stored = await storage.get(locator);
      if (stored.size !== input.size || stored.size === 0) {
        throw new EvidenceApiError(
          "INVALID_REQUEST",
          400,
          "The stored ZIP size does not match the authorised upload.",
        );
      }
      if (stored.contentType !== input.validation.contentType) {
        throw new EvidenceApiError(
          "UNSUPPORTED_FILE",
          400,
          "The stored ZIP type does not match the authorised upload.",
        );
      }
      const integrity = await contentHashStream(
        stored.stream,
        input.validation.maximumSizeBytes,
      );
      if (integrity.size !== stored.size) {
        throw new EvidenceApiError(
          "INVALID_REQUEST",
          400,
          "The stored ZIP could not be read completely.",
        );
      }

      const document = await finaliseEvidenceUpload(
        {
          ...input,
          documentId: input.documentId,
          validation: input.validation,
          locator,
          fileSize: stored.size,
          contentHash: integrity.contentHash,
        },
        { prisma, backup: overrides.backup },
      );
      return NextResponse.json(document, { status: 201 });
    } catch (error) {
      return evidenceErrorResponse(error);
    }
  };
}

export const POST = createDirectFinaliseHandler();
