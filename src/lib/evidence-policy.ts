export const MAX_STANDARD_EVIDENCE_FILE_BYTES = 4_000_000;
export const MAX_ZIP_EVIDENCE_FILE_BYTES = 500_000_000;
export const MAX_STANDARD_EVIDENCE_FILE_LABEL = "4 MB";
export const MAX_ZIP_EVIDENCE_FILE_LABEL = "500 MB";

/**
 * Kept for the buffered upload and existing callers. ZIP uploads use their
 * own direct-to-Blob path and must not broaden this limit.
 */
export const MAX_EVIDENCE_FILE_BYTES = MAX_STANDARD_EVIDENCE_FILE_BYTES;
export const MAX_EVIDENCE_FILE_LABEL = MAX_STANDARD_EVIDENCE_FILE_LABEL;
export const MAX_IMPORT_PREVIEW_FILE_BYTES = MAX_STANDARD_EVIDENCE_FILE_BYTES;

export const EVIDENCE_FILE_ACCEPT =
  ".pdf,.doc,.docx,.txt,.csv,.eml,.mbox,.png,.jpg,.jpeg,.gif,.webp,.mp3,.wav,.m4a,.mp4,.mov,.webm,.zip";

type SupportedEvidenceFormat = {
  contentTypes: readonly string[];
  maximumSizeBytes: number;
  maximumSizeLabel: string;
};

const supportedExtensions = new Map<string, SupportedEvidenceFormat>([
  [
    ".pdf",
    {
      contentTypes: ["application/pdf"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".doc",
    {
      contentTypes: ["application/msword"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".docx",
    {
      contentTypes: [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".txt",
    {
      contentTypes: ["text/plain"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".csv",
    {
      contentTypes: ["text/csv", "application/csv"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".eml",
    {
      contentTypes: ["message/rfc822", "text/plain"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".mbox",
    {
      contentTypes: [
        "application/mbox",
        "text/plain",
        "application/octet-stream",
      ],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".png",
    {
      contentTypes: ["image/png"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".jpg",
    {
      contentTypes: ["image/jpeg"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".jpeg",
    {
      contentTypes: ["image/jpeg"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".gif",
    {
      contentTypes: ["image/gif"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".webp",
    {
      contentTypes: ["image/webp"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".mp3",
    {
      contentTypes: ["audio/mpeg"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".wav",
    {
      contentTypes: ["audio/wav", "audio/x-wav"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".m4a",
    {
      contentTypes: ["audio/mp4", "audio/x-m4a"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".mp4",
    {
      contentTypes: ["video/mp4"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".mov",
    {
      contentTypes: ["video/quicktime"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".webm",
    {
      contentTypes: ["video/webm"],
      maximumSizeBytes: MAX_STANDARD_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_STANDARD_EVIDENCE_FILE_LABEL,
    },
  ],
  [
    ".zip",
    {
      contentTypes: [
        "application/zip",
        "application/x-zip-compressed",
        "multipart/x-zip",
      ],
      maximumSizeBytes: MAX_ZIP_EVIDENCE_FILE_BYTES,
      maximumSizeLabel: MAX_ZIP_EVIDENCE_FILE_LABEL,
    },
  ],
]);

export type EvidenceFileValidation = {
  originalFilename: string;
  safeFilename: string;
  contentType: string;
  maximumSizeBytes: number;
  maximumSizeLabel: string;
};

export type EvidenceFileDescriptor = Pick<File, "name" | "size" | "type">;

export function validateEvidenceFile(
  file: EvidenceFileDescriptor,
): EvidenceFileValidation {
  return validateEvidenceFileDescriptor(file);
}

export function validateEvidenceFileDescriptor(
  file: EvidenceFileDescriptor,
): EvidenceFileValidation {
  if (file.size === 0)
    throw new EvidenceFilePolicyError(
      "EMPTY_FILE",
      "The selected file is empty.",
    );
  const originalFilename = normaliseOriginalFilename(file.name);
  const format = supportedExtensions.get(extensionOf(originalFilename));
  if (!format) {
    throw new EvidenceFilePolicyError(
      "UNSUPPORTED_FILE",
      "This file type is not supported for evidence uploads.",
    );
  }
  if (file.size > format.maximumSizeBytes) {
    throw new EvidenceFilePolicyError(
      "FILE_TOO_LARGE",
      `Evidence files of this type must be ${format.maximumSizeLabel} or smaller.`,
    );
  }

  const suppliedType = file.type.trim().toLowerCase();
  const contentType =
    suppliedType && suppliedType !== "application/octet-stream"
      ? suppliedType
      : format.contentTypes[0];
  if (!format.contentTypes.includes(contentType)) {
    throw new EvidenceFilePolicyError(
      "UNSUPPORTED_FILE",
      "The file extension and content type do not match a supported evidence format.",
    );
  }

  return {
    originalFilename,
    safeFilename: sanitiseFilename(originalFilename),
    contentType,
    maximumSizeBytes: format.maximumSizeBytes,
    maximumSizeLabel: format.maximumSizeLabel,
  };
}

export function normaliseOriginalFilename(filename: string) {
  const base =
    filename
      .replace(/\\/g, "/")
      .split("/")
      .at(-1)
      ?.replace(/[\u0000-\u001f\u007f]/g, "")
      .trim() ?? "";
  if (!base || base === "." || base === ".." || base.length > 255) {
    throw new EvidenceFilePolicyError(
      "INVALID_FILENAME",
      "The selected file has an invalid filename.",
    );
  }
  return base;
}

export function sanitiseFilename(filename: string) {
  const sanitised = filename
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-+/g, "-")
    .slice(0, 160);
  return sanitised || "evidence-file";
}

export function createEvidenceStorageKey(
  caseId: string,
  documentId: string,
  safeFilename: string,
  objectId = globalThis.crypto.randomUUID(),
) {
  const opaqueCaseId = assertOpaqueIdentifier(caseId, "case");
  const opaqueDocumentId = assertOpaqueIdentifier(documentId, "document");
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(objectId)) {
    throw new EvidenceFilePolicyError(
      "INVALID_REFERENCE",
      "The storage object reference is invalid.",
    );
  }
  return `evidence/${opaqueCaseId}/${opaqueDocumentId}/${objectId}-${sanitiseFilename(safeFilename)}`;
}

function extensionOf(filename: string) {
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(index).toLowerCase() : "";
}

function assertOpaqueIdentifier(value: string, label: string) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(value)) {
    throw new EvidenceFilePolicyError(
      "INVALID_REFERENCE",
      `The ${label} reference is invalid.`,
    );
  }
  return value;
}

export class EvidenceFilePolicyError extends Error {
  constructor(
    public readonly code:
      | "EMPTY_FILE"
      | "FILE_TOO_LARGE"
      | "UNSUPPORTED_FILE"
      | "INVALID_FILENAME"
      | "INVALID_REFERENCE",
    message: string,
  ) {
    super(message);
    this.name = "EvidenceFilePolicyError";
  }
}
