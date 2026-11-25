import { describe, expect, it } from "vitest";
import { isSafeLegacyPath } from "./route";

describe("legacy evidence paths", () => {
  it("accepts stored relative path segments", () => {
    expect(isSafeLegacyPath(["imports", "stored-file.pdf"])).toBe(true);
  });

  it.each([
    { parts: ["..", "secret"] },
    { parts: ["folder/escape"] },
    { parts: ["folder\\escape"] },
    { parts: [""] },
    { parts: [] },
  ])("rejects traversal path $parts", ({ parts }) => {
    expect(isSafeLegacyPath(parts)).toBe(false);
  });
});
