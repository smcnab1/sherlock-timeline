import { describe, expect, it } from "vitest";
import { caseMaterialIds, createCaseExportEnvelope, hasBothEndpoints, remapImportedTagLinks } from "@/lib/case-transfer";

describe("case tag export and import compatibility", () => {
  it("round-trips shared and multiple material tag assignments", () => {
    const exported = createCaseExportEnvelope({
      case: {
        id: "case-a",
        events: [{ id: "event-a", tags: [{ tagId: "tag-shared" }, { tagId: "tag-event" }] }],
        documents: [{ id: "document-a", tags: [{ tagId: "tag-shared" }, { tagId: "tag-evidence" }] }],
      },
      people: [],
      tags: [
        { id: "tag-shared", caseId: "case-a", name: "Shared", colour: "#38bdf8" },
        { id: "tag-event", caseId: "case-a", name: "Event only", colour: "#f59e0b" },
        { id: "tag-evidence", caseId: "case-a", name: "Evidence only", colour: "#a78bfa" },
      ],
      relationships: [],
      personRelationships: [],
    }, "2026-08-27T09:00:00.000Z");
    const importedIds = new Map(exported.tags.map((tag) => [tag.id, `destination-${tag.id}`]));

    expect(exported.schemaVersion).toBe(2);
    expect(remapImportedTagLinks(exported.case.events[0].tags, importedIds)).toEqual([
      { tagId: "destination-tag-shared" },
      { tagId: "destination-tag-event" },
    ]);
    expect(remapImportedTagLinks(exported.case.documents[0].tags, importedIds)).toEqual([
      { tagId: "destination-tag-shared" },
      { tagId: "destination-tag-evidence" },
    ]);
  });

  it("accepts an older export with no evidence tag links", () => {
    expect(remapImportedTagLinks(undefined, new Map([["tag-a", "destination-tag-a"]]))).toEqual([]);
  });
});

describe("case export boundaries", () => {
  it("limits participants and relationship endpoints to exported material", () => {
    const ids = caseMaterialIds({
      events: [{ id: "meeting", people: [{ personId: "speaker" }] }],
      documents: [{ id: "memo", people: [{ personId: "author" }] }],
      actions: [{ ownerId: "chair" }, { ownerId: null }],
    });
    expect([...ids.people].sort()).toEqual(["author", "chair", "speaker"]);
    expect(hasBothEndpoints(ids.people, { sourceId: "chair", targetId: "author" })).toBe(true);
    expect(hasBothEndpoints(ids.people, { sourceId: "visitor", targetId: "chair" })).toBe(false);
    expect(hasBothEndpoints(ids.events, { sourceId: "meeting", targetId: "other-case-event" })).toBe(false);
  });
});
