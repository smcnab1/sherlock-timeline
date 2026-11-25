import { NextResponse } from "next/server";
import { evidenceErrorResponse } from "@/lib/evidence-error-response";
import { EvidenceApiError } from "@/lib/evidence-errors";
import { requireEvidenceAuthentication } from "@/lib/evidence-download";
import { approveImport } from "@/lib/import/pipeline";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireEvidenceAuthentication(request);
    const body = await request.json();
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    if (!jobId)
      throw new EvidenceApiError(
        "INVALID_REQUEST",
        400,
        "An import job is required.",
      );

    const job = await getPrisma().importJob.findFirst({
      where: { id: jobId, case: { deletedAt: null } },
      select: { id: true },
    });
    if (!job)
      throw new EvidenceApiError(
        "CASE_ACCESS_DENIED",
        403,
        "The import job does not belong to an accessible case.",
      );

    const approved = await approveImport(jobId, {
      ignoredMessageIds: Array.isArray(body.ignoredMessageIds)
        ? body.ignoredMessageIds
        : [],
    });
    return NextResponse.json(approved);
  } catch (error) {
    return evidenceErrorResponse(error);
  }
}
