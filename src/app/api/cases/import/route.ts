import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createCaseBackupBestEffort } from "@/lib/backup";
import {
  caseMaterialIds,
  hasBothEndpoints,
  remapImportedTagLinks,
} from "@/lib/case-transfer";
import { getPrisma } from "@/lib/prisma";
import { validateTagColour, validateTagName } from "@/lib/tagging";

type ExportCase = Prisma.CaseGetPayload<{
  include: {
    events: { include: { people: true; documents: true; tags: true } };
    documents: { include: { people: true; tags: true } };
    actions: true;
    auditTrail: true;
  };
}>;

type ImportPayload = {
  schemaVersion?: number;
  case?: ExportCase;
  people?: Prisma.PersonCreateManyInput[];
  tags?: Array<{
    id: string;
    name: string;
    colour: string;
    caseId?: string;
    normalizedName?: string;
  }>;
  relationships?: Prisma.RelationshipCreateManyInput[];
  personRelationships?: Prisma.PersonRelationshipCreateManyInput[];
};

export async function POST(request: Request) {
  let payload: ImportPayload;
  try {
    payload = (await request.json()) as ImportPayload;
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid JSON file. Use Investigation Import for emails, PDFs, MBOX, DOCX, and communication logs.",
      },
      { status: 400 },
    );
  }
  if (
    !payload?.case ||
    typeof payload.case.id !== "string" ||
    !payload.case.id.trim() ||
    !Array.isArray(payload.case.events) ||
    !Array.isArray(payload.case.documents) ||
    !Array.isArray(payload.case.actions) ||
    [
      payload.people,
      payload.tags,
      payload.relationships,
      payload.personRelationships,
    ].some((value) => value !== undefined && !Array.isArray(value))
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid Sherlock export. Use Investigation Import for communications.",
      },
      { status: 400 },
    );
  }

  const prisma = getPrisma();
  try {
    const imported = await prisma.$transaction(async (tx) => {
      const caseId = payload.case!.id;
      const ids = caseMaterialIds(payload.case!);
      const includedPeople = (payload.people ?? []).filter(
        (person) => person.id && ids.people.has(person.id),
      );
      const includedPersonIds = new Set(
        includedPeople.map((person) => person.id),
      );
      if ([...ids.people].some((id) => !includedPersonIds.has(id))) {
        throw new InvalidCaseExport();
      }
      // Delete by stored ownership. Foreign keys cascade the old case's material links.
      await tx.action.deleteMany({ where: { caseId } });
      await tx.event.deleteMany({ where: { caseId } });
      await tx.document.deleteMany({ where: { caseId } });
      await tx.auditEntry.deleteMany({ where: { caseId } });

      const restoredCase = await tx.case.upsert({
        where: { id: caseId },
        create: {
          id: caseId,
          title: payload.case!.title,
          description: payload.case!.description,
          status: payload.case!.status,
          createdAt: new Date(payload.case!.createdAt),
          updatedAt: new Date(payload.case!.updatedAt),
          deletedAt: payload.case!.deletedAt
            ? new Date(payload.case!.deletedAt)
            : null,
        },
        update: {
          title: payload.case!.title,
          description: payload.case!.description,
          status: payload.case!.status,
          deletedAt: payload.case!.deletedAt
            ? new Date(payload.case!.deletedAt)
            : null,
        },
      });

      if (includedPeople.length) {
        const shared = await tx.person.findMany({
          where: {
            id: { in: [...ids.people] },
            OR: [
              { events: { some: { event: { caseId: { not: caseId } } } } },
              {
                evidence: { some: { document: { caseId: { not: caseId } } } },
              },
              { actions: { some: { caseId: { not: caseId } } } },
              {
                conversationParticipants: {
                  some: { conversation: { caseId: { not: caseId } } },
                },
              },
              { sentMessages: { some: { caseId: { not: caseId } } } },
            ],
          },
          select: { id: true },
        });
        const sharedIds = new Set(shared.map((person) => person.id));
        for (const person of includedPeople) {
          if (person.id && sharedIds.has(person.id)) continue;
          const profile = {
            name: person.name,
            email: person.email,
            role: person.role,
            organisation: person.organisation,
            notes: person.notes,
            deletedAt: person.deletedAt,
            firstCommunicationAt: person.firstCommunicationAt,
            lastCommunicationAt: person.lastCommunicationAt,
            interactionCount: person.interactionCount,
          };
          await tx.person.upsert({
            where: { id: person.id },
            create: { id: person.id, ...profile },
            update: profile,
          });
        }
      }
      const importedTagIds = new Map<string, string>();
      if (payload.tags?.length) {
        for (const tag of payload.tags) {
          const { name, normalizedName } = validateTagName(tag.name);
          const colour = validateTagColour(tag.colour);
          const sameName = await tx.tag.findUnique({
            where: { caseId_normalizedName: { caseId, normalizedName } },
            select: { id: true },
          });
          if (sameName) {
            importedTagIds.set(tag.id, sameName.id);
            continue;
          }
          const idOwner = await tx.tag.findUnique({
            where: { id: tag.id },
            select: { caseId: true },
          });
          const destinationId =
            idOwner && idOwner.caseId !== caseId
              ? `${tag.id}_case_${crypto.randomUUID().replaceAll("-", "")}`
              : tag.id;
          await tx.tag.upsert({
            where: { id: destinationId },
            create: { id: destinationId, caseId, name, normalizedName, colour },
            update: { name, normalizedName, colour },
          });
          importedTagIds.set(tag.id, destinationId);
        }
      }

      for (const document of payload.case!.documents) {
        await tx.document.create({
          data: {
            id: document.id,
            caseId,
            title: document.title,
            filename: document.filename,
            description: document.description,
            sourceType: document.sourceType,
            confidenceScore: document.confidenceScore,
            contentHash: document.contentHash,
            originalContent: document.originalContent,
            extractedMetadata: document.extractedMetadata ?? undefined,
            sourceReference: document.sourceReference,
            confidenceLevel: document.confidenceLevel,
            path: document.path,
            filePath: document.filePath,
            fileSize: document.fileSize ?? 0,
            mimeType: document.mimeType,
            uploadedAt: new Date(document.uploadedAt),
            deletedAt: document.deletedAt ? new Date(document.deletedAt) : null,
            people: {
              create: document.people.map((link) => ({
                personId: link.personId,
                role: link.role,
              })),
            },
            tags: {
              create: remapImportedTagLinks(document.tags, importedTagIds),
            },
          },
        });
      }

      for (const event of payload.case!.events) {
        await tx.event.create({
          data: {
            id: event.id,
            caseId,
            title: event.title,
            description: event.description,
            notes: event.notes,
            eventType: event.eventType,
            machineGenerated: event.machineGenerated,
            confidenceScore: event.confidenceScore,
            sourceMessageId: event.sourceMessageId,
            category: event.category,
            importance: event.importance,
            status: event.status,
            startDate: new Date(event.startDate),
            endDate: event.endDate ? new Date(event.endDate) : null,
            createdAt: new Date(event.createdAt),
            deletedAt: event.deletedAt ? new Date(event.deletedAt) : null,
            people: {
              create: event.people.map((link) => ({
                personId: link.personId,
                role: link.role,
              })),
            },
            documents: {
              create: event.documents
                .filter((link) => ids.documents.has(link.documentId))
                .map((link) => ({ documentId: link.documentId })),
            },
            tags: {
              create: remapImportedTagLinks(event.tags, importedTagIds),
            },
          },
        });
      }

      if (payload.relationships?.length) {
        for (const relationship of payload.relationships.filter((edge) =>
          hasBothEndpoints(ids.events, edge),
        )) {
          await tx.relationship.upsert({
            where: {
              sourceId_targetId_relationshipType: {
                sourceId: relationship.sourceId,
                targetId: relationship.targetId,
                relationshipType: relationship.relationshipType,
              },
            },
            create: {
              sourceId: relationship.sourceId,
              targetId: relationship.targetId,
              relationshipType: relationship.relationshipType,
              createdAt: relationship.createdAt,
              machineGenerated: relationship.machineGenerated,
              confidenceScore: relationship.confidenceScore,
            },
            update: {},
          });
        }
      }
      if (payload.personRelationships?.length) {
        for (const relationship of payload.personRelationships.filter((edge) =>
          hasBothEndpoints(ids.people, edge),
        )) {
          await tx.personRelationship.upsert({
            where: {
              sourceId_targetId_relationshipType: {
                sourceId: relationship.sourceId,
                targetId: relationship.targetId,
                relationshipType: relationship.relationshipType,
              },
            },
            create: {
              sourceId: relationship.sourceId,
              targetId: relationship.targetId,
              relationshipType: relationship.relationshipType,
              notes: relationship.notes,
              createdAt: relationship.createdAt,
              machineGenerated: relationship.machineGenerated,
              confidenceScore: relationship.confidenceScore,
            },
            update: {},
          });
        }
      }
      if (payload.case!.actions.length) {
        await tx.action.createMany({
          data: payload.case!.actions.map((action) => ({
            id: action.id,
            caseId,
            title: action.title,
            description: action.description,
            ownerId: action.ownerId,
            dueDate: new Date(action.dueDate),
            status: action.status,
            eventId:
              action.eventId && ids.events.has(action.eventId)
                ? action.eventId
                : null,
            documentId:
              action.documentId && ids.documents.has(action.documentId)
                ? action.documentId
                : null,
            createdAt: new Date(action.createdAt),
            updatedAt: new Date(action.updatedAt),
            deletedAt: action.deletedAt ? new Date(action.deletedAt) : null,
          })),
        });
      }

      if (payload.case!.auditTrail?.length) {
        await tx.auditEntry.createMany({
          data: payload.case!.auditTrail.map((entry) => ({
            id: entry.id,
            caseId,
            entityType: entry.entityType,
            entityId: entry.entityId,
            action: entry.action,
            summary: entry.summary,
            createdAt: new Date(entry.createdAt),
          })),
        });
      }
      await tx.auditEntry.create({
        data: {
          caseId,
          entityType: "Case",
          entityId: caseId,
          action: "import",
          summary: `Imported full case data for "${restoredCase.title}"`,
        },
      });

      return restoredCase;
    });
    await createCaseBackupBestEffort(prisma, imported.id, "case-import");

    return NextResponse.json(imported);
  } catch (error) {
    if (
      error instanceof InvalidCaseExport ||
      error instanceof TypeError ||
      error instanceof Prisma.PrismaClientValidationError
    ) {
      return NextResponse.json(
        { error: "Invalid Sherlock export data" },
        { status: 400 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2003"].includes(error.code)
    ) {
      return NextResponse.json(
        { error: "The import conflicts with existing case records" },
        { status: 409 },
      );
    }
    console.error("Case import failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Failed to restore Sherlock export" },
      { status: 500 },
    );
  }
}

class InvalidCaseExport extends Error {}
