export type EvidenceApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTHENTICATION_NOT_CONFIGURED"
  | "CASE_NOT_FOUND"
  | "CASE_ACCESS_DENIED"
  | "EVIDENCE_NOT_FOUND"
  | "INVALID_REQUEST"
  | "INVALID_FILENAME"
  | "EMPTY_FILE"
  | "UNSUPPORTED_FILE"
  | "FILE_TOO_LARGE"
  | "STORAGE_NOT_CONFIGURED"
  | "STORAGE_AUTHENTICATION_FAILED"
  | "STORAGE_PROVIDER_FAILURE"
  | "STORED_OBJECT_MISSING"
  | "DATABASE_FAILURE";

export type EvidenceApiErrorBody = {
  error: {
    code: EvidenceApiErrorCode;
    message: string;
  };
};

export class EvidenceApiError extends Error {
  constructor(
    public readonly code: EvidenceApiErrorCode,
    public readonly status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EvidenceApiError";
  }
}

export async function evidenceApiErrorMessage(
  response: Response,
  fallback: string,
) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (response.status === 413)
      return "The file is too large for upload. Choose a file no larger than 4 MB.";
    if (response.status === 401)
      return "Your session has expired. Sign in and try again.";
    return fallback;
  }

  if (isEvidenceErrorBody(body)) return body.error.message;
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  )
    return body.error;
  return fallback;
}

export function uploadNetworkErrorMessage(error: unknown) {
  if (error instanceof TypeError)
    return "The upload was interrupted. Check your connection and try again.";
  return error instanceof Error && error.message
    ? error.message
    : "The evidence upload failed. Please try again.";
}

function isEvidenceErrorBody(body: unknown): body is EvidenceApiErrorBody {
  if (!body || typeof body !== "object" || !("error" in body)) return false;
  const error = body.error;
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string",
  );
}
