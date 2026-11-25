import {
  downloadEvidence,
  defaultDownloadDependencies,
} from "@/lib/evidence-download";
import { evidenceErrorResponse } from "@/lib/evidence-error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function createEvidenceDownloadHandler(
  dependencies = defaultDownloadDependencies(),
) {
  return async function GET(
    request: Request,
    { params }: { params: Promise<{ documentId: string }> },
  ) {
    try {
      const { documentId } = await params;
      return await downloadEvidence(request, documentId, dependencies);
    } catch (error) {
      return evidenceErrorResponse(error);
    }
  };
}

export const GET = createEvidenceDownloadHandler();
