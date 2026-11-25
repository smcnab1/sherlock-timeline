import { NextResponse } from "next/server";
import { caseMaterialIds, createCaseExportEnvelope } from "@/lib/case-transfer";
import { getPrisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const result = await getPrisma().$transaction(
    async (tx) => {
      const item = await tx.case.findUnique({
        where: { id: caseId },
        include: {
          events: {
            include: {
              people: true,
              documents: { where: { document: { caseId } } },
              tags: { where: { tag: { caseId } } },
            },
          },
          documents: {
            include: {
              people: true,
              events: { where: { event: { caseId } } },
              tags: { where: { tag: { caseId } } },
            },
          },
          actions: true,
          auditTrail: true,
        },
      });
      if (!item) return null;

      const ids = caseMaterialIds(item);
      const eventIds = [...ids.events];
      const personIds = [...ids.people];
      const people = await tx.person.findMany({
        where: { id: { in: personIds } },
      });
      const tags = await tx.tag.findMany({
        where: { caseId },
        orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      });
      const relationships = await tx.relationship.findMany({
        where: { sourceId: { in: eventIds }, targetId: { in: eventIds } },
      });
      const personRelationships = await tx.personRelationship.findMany({
        where: { sourceId: { in: personIds }, targetId: { in: personIds } },
      });
      const actions = item.actions.map((action) => ({
        ...action,
        eventId:
          action.eventId && ids.events.has(action.eventId)
            ? action.eventId
            : null,
        documentId:
          action.documentId && ids.documents.has(action.documentId)
            ? action.documentId
            : null,
      }));
      const auditTrail = item.auditTrail.map((entry) =>
        entry.entityType === "Backup" &&
        entry.summary.startsWith("Created backup at ")
          ? { ...entry, summary: "Created case backup" }
          : entry,
      );
      return createCaseExportEnvelope({
        case: { ...item, actions, auditTrail },
        people,
        tags,
        relationships,
        personRelationships,
      });
    },
    { isolationLevel: "RepeatableRead" },
  );

  if (!result)
    return NextResponse.json({ error: "Case not found" }, { status: 404 });

  return NextResponse.json(result, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${caseId.replace(/[^a-z0-9_-]/gi, "_")}-sherlock-export.json"`,
    },
  });
}
