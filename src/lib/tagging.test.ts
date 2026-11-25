import { describe, expect, it, vi } from "vitest";
import {
  assignmentChanges,
  MAX_TAG_NAME_LENGTH,
  TagApiError,
  tagErrorResponse,
  tagIdsFromUnknown,
  tagNameKey,
  validateTagColour,
  validateTagName,
  validateTagReferences,
} from "@/lib/tagging";

describe("tag validation", () => {
  it("keeps a readable name while normalising whitespace and case for uniqueness", () => {
    expect(validateTagName("  Unanswered   Emails  ")).toEqual({
      name: "Unanswered Emails",
      normalizedName: "unanswered emails",
    });
    expect(tagNameKey(" unanswered emails ")).toBe("unanswered emails");
  });

  it("rejects blank and unreasonably long names", () => {
    expect(() => validateTagName("   ")).toThrowError(TagApiError);
    expect(() => validateTagName("x".repeat(MAX_TAG_NAME_LENGTH + 1))).toThrow(
      `Tag names must be ${MAX_TAG_NAME_LENGTH} characters or fewer.`,
    );
  });

  it("accepts only six-digit hex colours", () => {
    expect(validateTagColour("#38BDF8")).toBe("#38bdf8");
    expect(() => validateTagColour("red")).toThrowError(TagApiError);
    expect(() => validateTagColour("#fff")).toThrowError(TagApiError);
  });

  it("deduplicates assignment IDs without accepting scalar input", () => {
    expect(tagIdsFromUnknown(["tag-a", " tag-a ", "", "tag-b"])).toEqual(["tag-a", "tag-b"]);
    expect(tagIdsFromUnknown("tag-a")).toEqual([]);
  });

  it("rejects selected tags unless every ID belongs to the case", async () => {
    const tag = { count: vi.fn().mockResolvedValue(1) };
    await expect(validateTagReferences({ tag } as never, "case-a", ["tag-a", "tag-b"]))
      .rejects.toMatchObject({ code: "TAG_CASE_MISMATCH", status: 403 });
    expect(tag.count).toHaveBeenCalledWith({
      where: { id: { in: ["tag-a", "tag-b"] }, caseId: "case-a" },
    });
  });

  it("reports additions and removals as one assignment change", () => {
    expect(assignmentChanges(["tag-a", "tag-b"], ["tag-b", "tag-c"])).toEqual({
      added: ["tag-c"],
      removed: ["tag-a"],
    });
  });

  it("returns a conflict for the database uniqueness guarantee", async () => {
    const response = tagErrorResponse({ code: "P2002" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "TAG_NAME_CONFLICT" } });
  });
});
