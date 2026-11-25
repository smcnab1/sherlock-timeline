import { readEvidenceMultipart } from "@/lib/evidence-multipart";
import { NextResponse } from "next/server";
import { evidenceErrorResponse } from "@/lib/evidence-error-response";
import { EvidenceApiError } from "@/lib/evidence-errors";
import { requireEvidenceAuthentication } from "@/lib/evidence-download";
import { MAX_IMPORT_PREVIEW_FILE_BYTES } from "@/lib/evidence-policy";
import { createImportPreview } from "@/lib/import/pipeline";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supportedImportExtensions = new Set([
  "pdf",
  "eml",
  "mbox",
  "docx",
  "txt",
]);

export async function POST(request: Request) {
  try {
    await requireEvidenceAuthentication(request);
    const form = await readEvidenceMultipart(request);
    const caseId = String(form.get("caseId") || "").trim();
    const files = form
      .getAll("files")
      .filter((file): file is File => file instanceof File);
    if (!caseId)
      throw new EvidenceApiError(
        "INVALID_REQUEST",
        400,
        "A case is required for investigation import.",
      );
    if (!files.length)
      throw new EvidenceApiError(
        "INVALID_REQUEST",
        400,
        "Select at least one import file.",
      );
    if (files.some((file) => file.size === 0))
      throw new EvidenceApiError(
        "EMPTY_FILE",
        400,
        "Import files cannot be empty.",
      );
    assertImportPreviewFileLimit(files);
    if (
      files.some(
        (file) =>
          !supportedImportExtensions.has(
            file.name.split(".").at(-1)?.toLowerCase() || "",
          ),
      )
    ) {
      throw new EvidenceApiError(
        "UNSUPPORTED_FILE",
        400,
        "Investigation import supports PDF, EML, MBOX, DOCX and TXT files.",
      );
    }

    const targetCase = await getPrisma().case.findFirst({
      where: { id: caseId, deletedAt: null },
      select: { id: true },
    });
    if (!targetCase)
      throw new EvidenceApiError(
        "CASE_NOT_FOUND",
        404,
        "The selected case no longer exists.",
      );

    const inputs = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type || "application/octet-stream",
        buffer: Buffer.from(await file.arrayBuffer()),
      })),
    );
    const preview = await createImportPreview(caseId, inputs);
    return NextResponse.json(preview);
  } catch (error) {
    if (!(error instanceof EvidenceApiError)) {
      console.error("Import preview failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return evidenceErrorResponse(error);
  }
}

export function assertImportPreviewFileLimit(
  files: ReadonlyArray<Pick<File, "size">>,
) {
  if (
    files.reduce((total, file) => total + file.size, 0) >
    MAX_IMPORT_PREVIEW_FILE_BYTES
  ) {
    throw new EvidenceApiError(
      "FILE_TOO_LARGE",
      413,
      "Import files must total 4 MB or less.",
    );
  }
}
