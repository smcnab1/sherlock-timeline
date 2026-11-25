import {
  createEvidenceStorageKey,
  MAX_ZIP_EVIDENCE_FILE_BYTES,
  validateEvidenceFileDescriptor,
  type EvidenceFileValidation,
} from "@/lib/evidence-policy";
import { EvidenceApiError } from "@/lib/evidence-errors";
import type { EvidenceUploadMetadata } from "@/lib/evidence-upload";

export type DirectEvidenceUpload = EvidenceUploadMetadata & {
  documentId: string;
  objectId: string;
  filename: string;
  contentType: string;
  size: number;
};

export type ValidatedDirectEvidenceUpload = DirectEvidenceUpload & {
  validation: EvidenceFileValidation;
  pathname: string;
};

export function parseDirectEvidenceUpload(
  value: unknown,
): ValidatedDirectEvidenceUpload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EvidenceApiError(
      "INVALID_REQUEST",
      400,
      "The upload details are invalid.",
    );
  }
  const input = value as Record<string, unknown>;
  const documentId = requiredUuid(input.documentId, "document");
  const objectId = requiredUuid(input.objectId, "storage object");
  const filename = requiredString(input.filename, "filename");
  const contentType = requiredString(input.contentType, "content type");
  const size = input.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new EvidenceApiError(
      "INVALID_REQUEST",
      400,
      "The file size is invalid.",
    );
  }
  const validation = validateEvidenceFileDescriptor({
    name: filename,
    type: contentType,
    size,
  });
  if (validation.maximumSizeBytes !== MAX_ZIP_EVIDENCE_FILE_BYTES) {
    throw new EvidenceApiError(
      "UNSUPPORTED_FILE",
      400,
      "Direct evidence uploads are reserved for ZIP evidence files.",
    );
  }

  const caseId = requiredString(input.caseId, "case");
  return {
    caseId,
    eventIds: stringList(input.eventIds),
    tagIds: stringList(input.tagIds),
    personId: optionalString(input.personId),
    title: optionalString(input.title),
    description: optionalString(input.description),
    sourceType: optionalString(input.sourceType),
    sourceReference: optionalString(input.sourceReference),
    confidenceLevel: optionalString(input.confidenceLevel),
    documentId,
    objectId,
    filename,
    contentType,
    size,
    validation,
    pathname: createEvidenceStorageKey(
      caseId,
      documentId,
      validation.safeFilename,
      objectId,
    ),
  };
}

function requiredString(value: unknown, label: string) {
  const parsed = optionalString(value);
  if (!parsed)
    throw new EvidenceApiError(
      "INVALID_REQUEST",
      400,
      `A ${label} is required.`,
    );
  return parsed;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredUuid(value: unknown, label: string) {
  const parsed = requiredString(value, label);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      parsed,
    )
  ) {
    throw new EvidenceApiError(
      "INVALID_REQUEST",
      400,
      `The ${label} reference is invalid.`,
    );
  }
  return parsed;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
