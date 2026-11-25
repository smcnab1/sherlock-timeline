import {
  EVIDENCE_FILE_ACCEPT,
  MAX_IMPORT_PREVIEW_FILE_BYTES,
  MAX_STANDARD_EVIDENCE_FILE_BYTES,
  MAX_ZIP_EVIDENCE_FILE_BYTES,
  validateEvidenceFileDescriptor,
} from "@/lib/evidence-policy";
import { describe, expect, it } from "vitest";

describe("evidence file policy", () => {
  it("accepts ZIP evidence and browser ZIP MIME variants", () => {
    for (const type of [
      "application/zip",
      "application/x-zip-compressed",
      "multipart/x-zip",
      "application/octet-stream",
      "",
    ]) {
      expect(
        validateEvidenceFileDescriptor({
          name: "case-material.zip",
          type,
          size: 1,
        }),
      ).toMatchObject({
        contentType:
          type && type !== "application/octet-stream"
            ? type
            : "application/zip",
        maximumSizeBytes: MAX_ZIP_EVIDENCE_FILE_BYTES,
      });
    }
  });

  it("rejects empty and over-limit ZIP evidence without allocating large buffers", () => {
    expect(() =>
      validateEvidenceFileDescriptor({
        name: "empty.zip",
        type: "application/zip",
        size: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "EMPTY_FILE" }));
    expect(() =>
      validateEvidenceFileDescriptor({
        name: "too-large.zip",
        type: "application/zip",
        size: MAX_ZIP_EVIDENCE_FILE_BYTES + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });

  it("accepts a ZIP exactly at the 500 MB decimal boundary", () => {
    expect(
      validateEvidenceFileDescriptor({
        name: "boundary.zip",
        type: "application/zip",
        size: MAX_ZIP_EVIDENCE_FILE_BYTES,
      }),
    ).toMatchObject({ maximumSizeBytes: 500_000_000 });
  });

  it("retains the ordinary evidence and import-preview limits", () => {
    expect(() =>
      validateEvidenceFileDescriptor({
        name: "large.pdf",
        type: "application/pdf",
        size: MAX_STANDARD_EVIDENCE_FILE_BYTES + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
    expect(MAX_IMPORT_PREVIEW_FILE_BYTES).toBe(4_000_000);
    expect(EVIDENCE_FILE_ACCEPT).toContain(".zip");
  });
});
