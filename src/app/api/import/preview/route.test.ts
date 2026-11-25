import { MAX_IMPORT_PREVIEW_FILE_BYTES } from "@/lib/evidence-policy";
import { describe, expect, it } from "vitest";
import { assertImportPreviewFileLimit } from "./route";

describe("investigation import preview limits", () => {
  it("retains the 4 MB aggregate limit independently of ZIP evidence", () => {
    expect(() =>
      assertImportPreviewFileLimit([{ size: MAX_IMPORT_PREVIEW_FILE_BYTES }]),
    ).not.toThrow();
    expect(() =>
      assertImportPreviewFileLimit([
        { size: MAX_IMPORT_PREVIEW_FILE_BYTES + 1 },
      ]),
    ).toThrowError(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });
});
