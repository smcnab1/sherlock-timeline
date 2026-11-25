import { expect, it } from "vitest";
import { readEvidenceMultipart } from "./evidence-multipart";

it("enforces the body limit when multipart length is unknown", async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(4_250_001)]), "sample.bin");
  const request = new Request("http://localhost/upload", { method: "POST", body: form });
  expect(request.headers.get("content-length")).toBeNull();
  await expect(readEvidenceMultipart(request)).rejects.toMatchObject({ code: "FILE_TOO_LARGE", status: 413 });
});
