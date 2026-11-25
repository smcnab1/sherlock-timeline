export type ExportEnvelope<
  TCase,
  TPerson,
  TTag,
  TRelationship,
  TPersonRelationship,
> = {
  schemaVersion: 2;
  exportedAt: string;
  case: TCase;
  people: TPerson[];
  tags: TTag[];
  relationships: TRelationship[];
  personRelationships: TPersonRelationship[];
};

export function createCaseExportEnvelope<
  TCase,
  TPerson,
  TTag,
  TRelationship,
  TPersonRelationship,
>(
  data: Omit<
    ExportEnvelope<TCase, TPerson, TTag, TRelationship, TPersonRelationship>,
    "schemaVersion" | "exportedAt"
  >,
  exportedAt = new Date().toISOString(),
): ExportEnvelope<TCase, TPerson, TTag, TRelationship, TPersonRelationship> {
  return { schemaVersion: 2, exportedAt, ...data };
}

export function remapImportedTagLinks(
  links: Array<{ tagId: string }> | undefined,
  importedTagIds: ReadonlyMap<string, string>,
) {
  return (links ?? [])
    .map((link) => importedTagIds.get(link.tagId))
    .filter((tagId): tagId is string => Boolean(tagId))
    .map((tagId) => ({ tagId }));
}

type CaseMaterial = {
  events: { id: string; people: { personId: string }[] }[];
  documents: { id: string; people: { personId: string }[] }[];
  actions: { ownerId: string | null }[];
};

export function caseMaterialIds(item: CaseMaterial) {
  return {
    events: new Set(item.events.map((event) => event.id)),
    documents: new Set(item.documents.map((document) => document.id)),
    people: new Set([
      ...item.events.flatMap((event) =>
        event.people.map((link) => link.personId),
      ),
      ...item.documents.flatMap((document) =>
        document.people.map((link) => link.personId),
      ),
      ...item.actions.flatMap((action) =>
        action.ownerId ? [action.ownerId] : [],
      ),
    ]),
  };
}

export function hasBothEndpoints(
  ids: ReadonlySet<string>,
  edge: { sourceId: string; targetId: string },
) {
  return ids.has(edge.sourceId) && ids.has(edge.targetId);
}
