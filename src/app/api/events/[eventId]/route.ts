import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";
import {
  assignmentAuditSummary,
  assignmentChanges,
  TagApiError,
  tagErrorResponse,
  tagIdsFromUnknown,
  validateTagReferences,
} from "@/lib/tagging";

const eventInclude = {
  people: { include: { person: true } },
  documents: { include: { document: { include: { tags: { include: { tag: true } } } } } },
  tags: { include: { tag: true } },
  conversation: { select: { id: true, title: true, status: true } },
} as const;

function eventPeopleFromBody(body: { people?: unknown; personId?: unknown }) {
  const seen = new Set<string>();
  const links: Array<{ personId: string; role: string }> = [];
  const source = Array.isArray(body.people) ? body.people : [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const personId = String("personId" in item ? item.personId || "" : "").trim();
    const role = String("role" in item ? item.role || "" : "").trim() || "Involved";
    if (!personId || seen.has(personId)) continue;
    seen.add(personId);
    links.push({ personId, role });
  }
  const legacyPersonId = String(body.personId || "").trim();
  if (!links.length && legacyPersonId) links.push({ personId: legacyPersonId, role: "Involved" });
  return links;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await params;
    const body = await readBody(request);
    const prisma = getPrisma();
    const existing = await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      include: { tags: { select: { tagId: true } } },
    });
    if (!existing) throw new TagApiError("EVENT_NOT_FOUND", 404, "This event no longer exists.");
    if (body.caseId !== undefined && String(body.caseId) !== existing.caseId) {
      throw new TagApiError("CASE_ACCESS_DENIED", 403, "This event does not belong to the selected investigation.");
    }

    const replacePeople = body.people !== undefined || body.personId !== undefined;
    const replaceTags = body.tagIds !== undefined;
    const people = eventPeopleFromBody(body);
    const previousTagIds = existing.tags.map((link) => link.tagId);
    const tagIds = replaceTags ? tagIdsFromUnknown(body.tagIds) : previousTagIds;
    if (replaceTags) await validateTagReferences(prisma, existing.caseId, tagIds);
    const changes = assignmentChanges(previousTagIds, tagIds);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          title: body.title === undefined ? undefined : String(body.title).trim(),
          description: body.description === undefined ? undefined : String(body.description).trim(),
          notes: body.notes === undefined ? undefined : String(body.notes).trim(),
          eventType: body.eventType === undefined ? undefined : String(body.eventType).trim(),
          category: body.category === undefined ? undefined : String(body.category).trim(),
          importance: body.importance === undefined ? undefined : String(body.importance).trim(),
          status: body.status === undefined ? undefined : String(body.status).trim(),
          startDate: body.startDate ? validDate(body.startDate) : undefined,
          endDate: body.endDate ? validDate(body.endDate) : body.endDate === "" ? null : undefined,
        },
      });
      if (replacePeople) {
        await tx.eventPerson.deleteMany({ where: { eventId } });
        if (people.length) await tx.eventPerson.createMany({ data: people.map((person) => ({ ...person, eventId })) });
      }
      if (replaceTags) {
        await tx.eventTag.deleteMany({ where: { eventId } });
        if (tagIds.length) await tx.eventTag.createMany({ data: tagIds.map((tagId) => ({ eventId, tagId })) });
      }
      const entity = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });
      await tx.auditEntry.create({
        data: {
          caseId: existing.caseId,
          entityType: "Event",
          entityId: eventId,
          action: changes.added.length || changes.removed.length ? "update-tags" : "update",
          summary: assignmentAuditSummary(`Updated event "${entity.title}"`, changes),
        },
      });
      return entity;
    });

    await createCaseBackupBestEffort(prisma, existing.caseId, "event-update", { eventId });
    return NextResponse.json(updated);
  } catch (error) {
    return tagErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await params;
    const prisma = getPrisma();
    const existing = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!existing) throw new TagApiError("EVENT_NOT_FOUND", 404, "This event no longer exists.");
    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id: eventId }, data: { deletedAt: new Date() } });
      await tx.auditEntry.create({
        data: {
          caseId: existing.caseId,
          entityType: "Event",
          entityId: eventId,
          action: "soft-delete",
          summary: `Soft deleted event "${existing.title}"`,
        },
      });
    });
    await createCaseBackupBestEffort(prisma, existing.caseId, "event-archive", { eventId });
    return NextResponse.json({ ok: true, eventId });
  } catch (error) {
    return tagErrorResponse(error);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
    return body as Record<string, unknown>;
  } catch {
    throw new TagApiError("INVALID_REQUEST", 400, "The event request body is invalid.");
  }
}

function validDate(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new TagApiError("INVALID_REQUEST", 400, "Enter a valid event date.");
  return date;
}
