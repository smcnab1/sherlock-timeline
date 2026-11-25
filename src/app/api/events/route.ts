import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";
import {
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

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const caseId = requiredString(body.caseId, "An investigation is required.");
    const tagIds = tagIdsFromUnknown(body.tagIds);
    const people = eventPeopleFromBody(body);
    const prisma = getPrisma();
    const investigation = await prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
      select: { id: true },
    });
    if (!investigation) throw new TagApiError("CASE_NOT_FOUND", 404, "The selected investigation no longer exists.");
    await validateTagReferences(prisma, caseId, tagIds);

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          caseId,
          title: requiredString(body.title, "Enter an event title."),
          description: optionalString(body.description),
          notes: optionalString(body.notes),
          eventType: optionalString(body.eventType) || "note",
          category: optionalString(body.category) || "General",
          importance: optionalString(body.importance) || "medium",
          status: optionalString(body.status) || "open",
          startDate: requiredDate(body.startDate),
          endDate: body.endDate ? requiredDate(body.endDate) : null,
          people: people.length ? { create: people } : undefined,
          tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
        include: eventInclude,
      });
      await tx.auditEntry.create({
        data: {
          caseId,
          entityType: "Event",
          entityId: created.id,
          action: "create",
          summary: `Created event "${created.title}"${tagIds.length ? ` with ${tagIds.length} tag${tagIds.length === 1 ? "" : "s"}` : ""}`,
        },
      });
      return created;
    });

    await createCaseBackupBestEffort(prisma, caseId, "event-create", { eventId: event.id });
    return NextResponse.json(event, { status: 201 });
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

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredString(value: unknown, message: string) {
  const text = optionalString(value);
  if (!text) throw new TagApiError("INVALID_REQUEST", 400, message);
  return text;
}

function requiredDate(value: unknown) {
  const date = new Date(requiredString(value, "Enter a valid event date."));
  if (Number.isNaN(date.getTime())) throw new TagApiError("INVALID_REQUEST", 400, "Enter a valid event date.");
  return date;
}
