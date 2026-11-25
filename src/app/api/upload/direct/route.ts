import {
  issueSignedToken,
  presignUrl,
  type PresignedUrlPayload,
} from "@vercel/blob";
import { NextResponse } from "next/server";
import { parseDirectEvidenceUpload } from "@/lib/direct-evidence-upload";
import { evidenceErrorResponse } from "@/lib/evidence-error-response";
import { EvidenceApiError } from "@/lib/evidence-errors";
import { requireEvidenceAuthentication } from "@/lib/evidence-download";
import {
  validateEvidenceReferences,
  type UploadPrisma,
} from "@/lib/evidence-upload";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DirectUploadDependencies = {
  prisma: UploadPrisma;
  issueToken: typeof issueSignedToken;
  presign: typeof presignUrl;
};

export function createDirectUploadHandler(
  overrides: Partial<DirectUploadDependencies> = {},
) {
  return async function POST(request: Request) {
    try {
      const body = await readPresignedRequest(request);
      await requireEvidenceAuthentication(request);
      if (!body.payload.multipart)
        throw new EvidenceApiError(
          "INVALID_REQUEST",
          400,
          "ZIP evidence uploads must use multipart transfer.",
        );
      const input = parseDirectEvidenceUpload(
        parseClientPayload(body.payload.clientPayload),
      );
      if (body.payload.pathname !== input.pathname)
        throw new EvidenceApiError(
          "INVALID_REQUEST",
          400,
          "The upload path is invalid.",
        );
      const prisma = overrides.prisma ?? getPrisma();
      await validateEvidenceReferences(prisma, input);
      const validUntil = Date.now() + 10 * 60 * 1_000;
      const token = await (overrides.issueToken ?? issueSignedToken)({
        pathname: input.pathname,
        operations: ["put"],
        allowedContentTypes: [input.validation.contentType],
        maximumSizeInBytes: input.validation.maximumSizeBytes,
        validUntil,
      });
      const signed = await (overrides.presign ?? presignUrl)(token, {
        operation: "put",
        pathname: input.pathname,
        access: "private",
        allowedContentTypes: [input.validation.contentType],
        maximumSizeInBytes: input.validation.maximumSizeBytes,
        validUntil,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
      });
      return NextResponse.json({
        type: "blob.generate-presigned-url",
        presignedUrlPayload: payloadFromPresignedUrl(signed.presignedUrl),
      });
    } catch (error) {
      return evidenceErrorResponse(error);
    }
  };
}

export const POST = createDirectUploadHandler();

async function readPresignedRequest(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new EvidenceApiError(
        "INVALID_REQUEST",
        400,
        "The upload request is invalid.",
      );
    const event = body as { type?: unknown; payload?: unknown };
    if (
      event.type !== "blob.generate-presigned-url" ||
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    )
      throw new EvidenceApiError(
        "INVALID_REQUEST",
        400,
        "The upload request is invalid.",
      );
    const payload = event.payload as Record<string, unknown>;
    if (
      typeof payload.pathname !== "string" ||
      typeof payload.multipart !== "boolean" ||
      (payload.clientPayload !== null &&
        typeof payload.clientPayload !== "string")
    )
      throw new EvidenceApiError(
        "INVALID_REQUEST",
        400,
        "The upload request is invalid.",
      );
    return {
      payload: {
        pathname: payload.pathname,
        clientPayload: payload.clientPayload,
        multipart: payload.multipart,
      },
    };
  } catch (error) {
    if (error instanceof EvidenceApiError) throw error;
    throw new EvidenceApiError(
      "INVALID_REQUEST",
      400,
      "The upload request is invalid.",
      { cause: error },
    );
  }
}

function parseClientPayload(value: string | null) {
  if (!value)
    throw new EvidenceApiError(
      "INVALID_REQUEST",
      400,
      "The upload details are missing.",
    );
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new EvidenceApiError(
      "INVALID_REQUEST",
      400,
      "The upload details are invalid.",
      { cause: error },
    );
  }
}

function payloadFromPresignedUrl(value: string): PresignedUrlPayload {
  const url = new URL(value);
  const delegationToken = url.searchParams.get("vercel-blob-delegation");
  const signature = url.searchParams.get("vercel-blob-signature");
  if (!delegationToken || !signature)
    throw new EvidenceApiError(
      "STORAGE_PROVIDER_FAILURE",
      502,
      "Vercel Blob could not authorise the upload.",
    );
  const params: Record<string, string> = {};
  for (const [key, parameter] of url.searchParams)
    if (
      key.startsWith("vercel-blob-") &&
      key !== "vercel-blob-delegation" &&
      key !== "vercel-blob-signature"
    )
      params[key] = parameter;
  return { delegationToken, signature, params };
}
