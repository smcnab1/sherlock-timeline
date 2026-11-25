import { EvidenceApiError } from "@/lib/evidence-errors";

// Allow for multipart field names and headers around a 4 MB file payload.
const maximumRequestBytes = 4_250_000;

export async function readEvidenceMultipart(request: Request) {
  const tooLarge = () => new EvidenceApiError(
    "FILE_TOO_LARGE", 413, "Files must total 4 MB or less.",
  );
  if (Number(request.headers.get("content-length")) > maximumRequestBytes) throw tooLarge();
  let bytes = 0;
  const limited = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maximumRequestBytes) throw tooLarge();
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(limited, { headers: request.headers }).formData();
  } catch (error) {
    if (bytes > maximumRequestBytes) throw tooLarge();
    throw new EvidenceApiError("INVALID_REQUEST", 400, "The upload request is not valid multipart form data.", { cause: error });
  }
}
