import { NextResponse } from "next/server";
import { evidenceErrorResponse } from "@/lib/evidence-error-response";
import { EvidenceApiError } from "@/lib/evidence-errors";
import { requireEvidenceAuthentication } from "@/lib/evidence-download";
import { getPrisma } from "@/lib/prisma";
import { publicUploadPath } from "@/lib/runtime-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    await requireEvidenceAuthentication(request);
    const { path: parts } = await params;
    if (!isSafeLegacyPath(parts)) {
      throw new EvidenceApiError(
        "INVALID_REQUEST",
        400,
        "The evidence download path is invalid.",
      );
    }

    const encodedPath = publicUploadPath(...parts);
    const legacyPath = `/uploads/${parts.join("/")}`;
    const document = await getPrisma().document.findFirst({
      where: {
        path:
          encodedPath === legacyPath
            ? encodedPath
            : { in: [encodedPath, legacyPath] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!document) {
      throw new EvidenceApiError(
        "EVIDENCE_NOT_FOUND",
        404,
        "No evidence metadata exists for this path.",
      );
    }

    return NextResponse.redirect(
      new URL(
        `/api/evidence/${encodeURIComponent(document.id)}/download`,
        request.url,
      ),
      307,
    );
  } catch (error) {
    return evidenceErrorResponse(error);
  }
}

export function isSafeLegacyPath(parts: string[]) {
  return Boolean(
    parts.length &&
    parts.every(
      (part) =>
        part &&
        part !== "." &&
        part !== ".." &&
        !part.includes("/") &&
        !part.includes("\\") &&
        !part.includes("\u0000"),
    ),
  );
}
