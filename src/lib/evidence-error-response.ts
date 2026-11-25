import { NextResponse } from "next/server";
import {
  EvidenceApiError,
  type EvidenceApiErrorBody,
} from "@/lib/evidence-errors";
import { EvidenceFilePolicyError } from "@/lib/evidence-policy";
import { StorageError } from "@/lib/runtime-storage";

export function evidenceErrorResponse(error: unknown) {
  const mapped = mapEvidenceError(error);
  const body: EvidenceApiErrorBody = {
    error: { code: mapped.code, message: mapped.message },
  };
  return NextResponse.json(body, { status: mapped.status });
}

function mapEvidenceError(error: unknown) {
  if (error instanceof EvidenceApiError) return error;
  if (error instanceof EvidenceFilePolicyError) {
    const status = error.code === "FILE_TOO_LARGE" ? 413 : 400;
    return new EvidenceApiError(
      error.code === "INVALID_REFERENCE" ? "INVALID_REQUEST" : error.code,
      status,
      error.message,
      { cause: error },
    );
  }
  if (error instanceof StorageError) {
    const statuses: Record<StorageError["code"], number> = {
      STORAGE_NOT_CONFIGURED: 503,
      STORAGE_AUTHENTICATION_FAILED: 503,
      STORAGE_PROVIDER_FAILURE: 502,
      STORED_OBJECT_MISSING: 404,
      INVALID_STORAGE_PATH: 500,
    };
    const messages: Record<StorageError["code"], string> = {
      STORAGE_NOT_CONFIGURED:
        "Evidence storage is not configured for this deployment. Contact the administrator.",
      STORAGE_AUTHENTICATION_FAILED:
        "Evidence storage rejected the deployment credentials. Contact the administrator.",
      STORAGE_PROVIDER_FAILURE:
        "The evidence storage provider could not complete the operation. Try again later.",
      STORED_OBJECT_MISSING: "The stored evidence file is missing.",
      INVALID_STORAGE_PATH: "The evidence storage reference is invalid.",
    };
    return new EvidenceApiError(
      error.code === "INVALID_STORAGE_PATH"
        ? "STORAGE_PROVIDER_FAILURE"
        : error.code,
      statuses[error.code],
      messages[error.code],
      { cause: error },
    );
  }
  console.error("Unexpected evidence operation failure", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return new EvidenceApiError(
    "DATABASE_FAILURE",
    500,
    "The evidence record could not be saved. Try again.",
    { cause: error },
  );
}
