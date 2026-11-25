import { expect, it, vi } from "vitest";
import { createImportPreview } from "./pipeline";

vi.mock("@/lib/runtime-storage", () => ({
  storeUploadFile: vi.fn(async () => ({ publicPath: "/uploads/sample.pdf", filePath: "sample.pdf" })),
  deleteStoredUploadFile: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    conversationMessage: { findMany: async () => [] },
    person: { findMany: async () => [] },
    importJob: { create: async () => ({ id: "preview" }) },
  }),
}));

// Produce an ASCII PDF with real object offsets and one text operation.
function samplePdf() {
  const stream = "BT /F1 12 Tf 20 80 Td (Subject: Archive catalogue review) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

it("extracts the subject from a PDF in an investigation import preview", async () => {
  const preview = await createImportPreview("case-a", [
    { name: "sample.pdf", type: "application/pdf", buffer: samplePdf() },
  ]);
  expect(preview.events.map((event) => event.title)).toEqual(["Archive catalogue review"]);
});
