import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createCaseBackup } from "@/lib/backup";
import { EvidenceApiError } from "@/lib/evidence-errors";
import type { EvidenceFileValidation } from "@/lib/evidence-policy";
import {
  publicUploadPath,
  StorageError,
  type EvidenceStorage,
} from "@/lib/runtime-storage";

export type UploadPrisma = Pick<
  PrismaClient,
  "case" | "document" | "event" | "person" | "tag" | "$transaction"
>;

export type EvidenceUploadMetadata = {
  caseId: string;
  eventIds: string[];
  tagIds: string[];
  personId: string;
  title: string;
  description: string;
  sourceType: string;
  sourceReference: string;
  confidenceLevel: string;
};

type FinaliseEvidenceUploadInput = EvidenceUploadMetadata & {
  documentId: string;
  validation: EvidenceFileValidation;
  locator: string;
  fileSize: number;
  contentHash: string;
};

type FinaliseEvidenceUploadDependencies = {
  prisma: UploadPrisma;
  // A server-buffered upload owns the object it just created. Direct uploads
  // supply an existing locator which can also be referenced by another retry.
  newlyStoredObject?: EvidenceStorage;
  backup?: (
    prisma: PrismaClient,
    caseId: string,
    reason: string,
  ) => Promise<unknown>;
};

export async function validateEvidenceReferences(
  prisma: UploadPrisma,
  {
    caseId,
    eventIds,
    tagIds,
    personId,
  }: Pick<
    EvidenceUploadMetadata,
    "caseId" | "eventIds" | "tagIds" | "personId"
  >,
) {
  const targetCase = await prisma.case.findFirst({
    where: { id: caseId, deletedAt: null },
    select: { id: true },
  });
  if (!targetCase) {
    throw new EvidenceApiError(
      "CASE_NOT_FOUND",
      404,
      "The selected case no longer exists.",
    );
  }

  if (eventIds.length) {
    const matchingEvents = await prisma.event.count({
      where: { id: { in: eventIds }, caseId, deletedAt: null },
    });
    if (matchingEvents !== eventIds.length) {
      throw new EvidenceApiError(
        "CASE_ACCESS_DENIED",
        403,
        "One or more selected events do not belong to this case.",
      );
    }
  }

  if (tagIds.length) {
    const matchingTags = await prisma.tag.count({
      where: { id: { in: tagIds }, caseId },
    });
    if (matchingTags !== tagIds.length) {
      throw new EvidenceApiError(
        "CASE_ACCESS_DENIED",
        403,
        "One or more selected tags do not belong to this case.",
      );
    }
  }

  if (personId) {
    const person = await prisma.person.findFirst({
      where: { id: personId, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      throw new EvidenceApiError(
        "INVALID_REQUEST",
        400,
        "The selected person no longer exists.",
      );
    }
  }
}

export async function finaliseEvidenceUpload(
  input: FinaliseEvidenceUploadInput,
  dependencies: FinaliseEvidenceUploadDependencies,
) {
  let document;
  try {
    document = await dependencies.prisma.$transaction(async (tx) =>
      createDocumentTransaction(tx, input),
    );
  } catch (error) {
    // A lost acknowledgement can leave a committed document even after the
    // transaction promise rejects. Preserve the object if its state is unknown.
    let existing;
    try {
      existing = await dependencies.prisma.document.findFirst({
        where: { id: input.documentId, caseId: input.caseId, filePath: input.locator },
        include: documentLinks,
      });
    } catch {
      throw new EvidenceApiError("DATABASE_FAILURE", 500,
        "The evidence record could not be confirmed. Its stored file has been retained.", { cause: error });
    }
    if (existing && !existing.deletedAt && existing.contentHash === input.contentHash) return existing;
    if (existing || !dependencies.newlyStoredObject) {
      throw new EvidenceApiError("DATABASE_FAILURE", 500,
        "The evidence record could not be confirmed. Its stored file has been retained.", { cause: error });
    }
    let cleanupConfirmed = true;
    try {
      await dependencies.newlyStoredObject.delete(input.locator);
    } catch (cleanupError) {
      cleanupConfirmed = false;
      console.error(
        "Evidence database write failed and stored-object cleanup also failed",
        {
          documentId: input.documentId,
          cleanupCode:
            cleanupError instanceof StorageError
              ? cleanupError.code
              : "UNKNOWN",
        },
      );
    }
    throw new EvidenceApiError(
      "DATABASE_FAILURE",
      500,
      cleanupConfirmed
        ? "The evidence record could not be created. The stored copy was rolled back; try again."
        : "The evidence record could not be created, and automatic storage cleanup could not be confirmed. Contact the administrator before retrying.",
      { cause: error },
    );
  }

  try {
    await (dependencies.backup ?? createCaseBackup)(
      dependencies.prisma as PrismaClient,
      input.caseId,
      "evidence-upload",
    );
  } catch (error) {
    console.error(
      "Evidence upload succeeded, but the follow-up case backup failed",
      {
        caseId: input.caseId,
        documentId: input.documentId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    );
  }

  return document;
}

export function contentHash(body: Buffer) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export async function contentHashStream(
  stream: ReadableStream<Uint8Array>,
  maximumSizeBytes: number,
) {
  const hash = crypto.createHash("sha256");
  let size = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumSizeBytes) {
        throw new EvidenceApiError(
          "FILE_TOO_LARGE",
          413,
          "The stored evidence file exceeds its permitted size.",
        );
      }
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) {
    throw new EvidenceApiError(
      "EMPTY_FILE",
      400,
      "The selected file is empty.",
    );
  }
  return { contentHash: hash.digest("hex"), size };
}

const documentLinks = {
      people: { include: { person: true } },
      tags: { include: { tag: true } },
      events: { include: { event: true } },
    } as const;

async function createDocumentTransaction(
  tx: Prisma.TransactionClient,
  input: FinaliseEvidenceUploadInput,
) {
  const document = await tx.document.create({
    data: {
      id: input.documentId,
      caseId: input.caseId,
      title: input.title || input.validation.originalFilename,
      filename: input.validation.originalFilename,
      description: input.description || "Uploaded evidence",
      sourceType: input.sourceType || "Other",
      sourceReference: input.sourceReference,
      confidenceLevel: input.confidenceLevel || "Documented",
      path: publicUploadPath(
        `${input.documentId}-${input.validation.safeFilename}`,
      ),
      filePath: input.locator,
      fileSize: input.fileSize,
      mimeType: input.validation.contentType,
      contentHash: input.contentHash,
      events: input.eventIds.length
        ? { create: input.eventIds.map((eventId) => ({ eventId })) }
        : undefined,
      people: input.personId
        ? { create: [{ personId: input.personId, role: "Witness" }] }
        : undefined,
      tags: input.tagIds.length
        ? { create: input.tagIds.map((tagId) => ({ tagId })) }
        : undefined,
    },
    include: documentLinks,
  });
  await tx.auditEntry.create({
    data: {
      caseId: input.caseId,
      entityType: "Evidence",
      entityId: document.id,
      action: "upload",
      summary: `Uploaded evidence "${document.title || document.filename}"${input.tagIds.length ? ` with ${input.tagIds.length} tag${input.tagIds.length === 1 ? "" : "s"}` : ""}`,
    },
  });
  return document;
}
