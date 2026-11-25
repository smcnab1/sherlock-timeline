# Sherlock case export format

Sherlock JSON exports use `schemaVersion: 2` for case-scoped material tags.

Each item in the top-level `tags` array belongs to the exported case and contains its stable `id`, human-readable `name`, normalised name key, colour and `caseId`. Event assignments remain in `case.events[].tags` as `{ "eventId", "tagId" }` links. Evidence assignments use the equivalent `case.documents[].tags` links with `{ "documentId", "tagId" }`.

The importer maps all tag links to the destination case. If a tag ID is already owned by another case, Sherlock creates a safe destination ID instead of modifying the other case's tag. Names are normalised during import so case-insensitive duplicates resolve to one reusable destination tag.

Older exports remain supported. An export without `schemaVersion`, without a top-level `tags` array, or without `case.documents[].tags` imports with no evidence-tag assignments. Existing event-tag links continue to import when their matching top-level tag definitions are present.
