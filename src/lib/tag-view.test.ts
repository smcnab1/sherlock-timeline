import { describe, expect, it } from "vitest";
import { materialHasTag, sortAndFilterTags, tagTotal } from "@/lib/tag-view";
import type { Tag } from "@/lib/types";

const tags: Tag[] = [
  { id: "tag-10", caseId: "case-a", name: "Policy 10", colour: "#38bdf8", _count: { events: 1, documents: 0 } },
  { id: "tag-2", caseId: "case-a", name: "policy 2", colour: "#f59e0b", _count: { events: 2, documents: 3 } },
];

describe("Tags view helpers", () => {
  it("sorts names predictably and totals both material groups", () => {
    expect(sortAndFilterTags(tags, "POLICY", "name").map((tag) => tag.id)).toEqual(["tag-2", "tag-10"]);
    expect(sortAndFilterTags(tags, "", "total").map((tag) => tag.id)).toEqual(["tag-2", "tag-10"]);
    expect(tagTotal(tags[1])).toBe(5);
  });

  it("matches assignments by stable ID rather than display name", () => {
    expect(materialHasTag([{ tag: { id: "tag-2" } }], "tag-2")).toBe(true);
    expect(materialHasTag([{ tag: { id: "tag-2" } }], "policy 2")).toBe(false);
  });
});
