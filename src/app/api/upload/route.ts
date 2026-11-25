import { readEvidenceMultipart } from "@/lib/evidence-multipart";
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { evidenceErrorResponse } from "@/lib/evidence-error-response";
import { EvidenceApiError } from "@/lib/evidence-errors";
import { requireEvidenceAuthentication } from "@/lib/evidence-download";
import {
  createEvidenceStorageKey,
  validateEvidenceFile,
} from "@/lib/evidence-policy";
import {
  contentHash,
  finaliseEvidenceUpload,
  validateEvidenceReferences,
  type EvidenceUploadMetadata,
  type UploadPrisma,
} from "@/lib/evidence-upload";
import { getPrisma } from "@/lib/prisma";
import {
  createRuntimeEvidenceStorage,
  type EvidenceStorage,
} from "@/lib/runtime-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadDependencies = {
  prisma: UploadPrisma;
  storage: EvidenceStorage;
  backup: (
    prisma: PrismaClient,
    caseId: string,
    reason: string,
  ) => Promise<unknown>;
};

export function createUploadHandler(
  overrides: Partial<UploadDependencies> = {},
) {
  return async function POST(request: Request) {
    try {
      await requireEvidenceAuthentication(request);
      const form = await readEvidenceMultipart(request);
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new EvidenceApiError(
          "INVALID_REQUEST",
          400,
          "Select a file to upload.",
        );
      }

      const validation = validateEvidenceFile(file);
      const metadata = metadataFromForm(form);
      const prisma = overrides.prisma ?? getPrisma();
      await validateEvidenceReferences(prisma, metadata);

      const body = Buffer.from(await file.arrayBuffer());
      if (
        body.byteLength !== file.size ||
        body.byteLength > validation.maximumSizeBytes
      ) {
        throw new EvidenceApiError(
          "FILE_TOO_LARGE",
          413,
          "The file is too large or could not be read completely.",
        );
      }

      const documentId = crypto.randomUUID();
      const storage = overrides.storage ?? createRuntimeEvidenceStorage();
      const stored = await storage.put({
        key: createEvidenceStorageKey(
          metadata.caseId,
          documentId,
          validation.safeFilename,
        ),
        body,
        contentType: validation.contentType,
      });

      const document = await finaliseEvidenceUpload(
        {
          ...metadata,
          documentId,
          validation,
          locator: stored.locator,
          fileSize: body.byteLength,
          contentHash: contentHash(body),
        },
        { prisma, newlyStoredObject: storage, backup: overrides.backup },
      );
      return NextResponse.json(document, { status: 201 });
    } catch (error) {
      return evidenceErrorResponse(error);
    }
  };
}

export const POST = createUploadHandler();

function metadataFromForm(form: FormData): EvidenceUploadMetadata {
  const caseId = requiredText(
    form,
    "caseId",
    "A case is required for evidence uploads.",
  );
  return {
    caseId,
    eventIds: uniqueFormValues(form, "eventIds", "eventId"),
    tagIds: uniqueFormValues(form, "tagIds"),
    personId: optionalText(form, "personId"),
    title: optionalText(form, "title"),
    description: optionalText(form, "description"),
    sourceType: optionalText(form, "sourceType"),
    sourceReference: optionalText(form, "sourceReference"),
    confidenceLevel: optionalText(form, "confidenceLevel"),
  };
}

function requiredText(form: FormData, key: string, message: string) {
  const value = optionalText(form, key);
  if (!value) throw new EvidenceApiError("INVALID_REQUEST", 400, message);
  return value;
}

function optionalText(form: FormData, key: string) {
  return String(form.get(key) || "").trim();
}

function uniqueFormValues(form: FormData, ...keys: string[]) {
  return [
    ...new Set(
      keys
        .flatMap((key) => form.getAll(key))
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
}
