import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";
import {
  TagApiError,
  tagErrorResponse,
  validateTagColour,
  validateTagName,
} from "@/lib/tagging";

const tagInclude = {
  _count: {
    select: {
      events: { where: { event: { deletedAt: null } } },
      documents: { where: { document: { deletedAt: null } } },
    },
  },
} as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tagId: string }> },
) {
  try {
    const { tagId } = await params;
    const body = await readBody(request);
    const caseId = requiredCaseId(body.caseId);
    const prisma = getPrisma();
    const existing = await findTag(prisma, tagId, caseId);
    const nameInput = body.name === undefined ? null : validateTagName(body.name);
    const colour = body.colour === undefined ? null : validateTagColour(body.colour);
    if (!nameInput && !colour) {
      throw new TagApiError("INVALID_REQUEST", 400, "Provide a name or colour to update.");
    }
    if (
      (nameInput?.name ?? existing.name) === existing.name &&
      (colour ?? existing.colour) === existing.colour
    ) {
      return NextResponse.json(existing);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const tag = await tx.tag.update({
        where: { id: existing.id },
        data: {
          name: nameInput?.name,
          normalizedName: nameInput?.normalizedName,
          colour: colour ?? undefined,
        },
        include: tagInclude,
      });
      const changes = [
        tag.name !== existing.name ? `renamed "${existing.name}" to "${tag.name}"` : "",
        tag.colour !== existing.colour ? `changed colour to ${tag.colour}` : "",
      ].filter(Boolean);
      await tx.auditEntry.create({
        data: {
          caseId,
          entityType: "Tag",
          entityId: tag.id,
          action: "update",
          summary: `Updated tag: ${changes.join("; ")}`,
        },
      });
      return tag;
    });

    await createCaseBackupBestEffort(prisma, caseId, "tag-update", { tagId });
    return NextResponse.json(updated);
  } catch (error) {
    return tagErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tagId: string }> },
) {
  try {
    const { tagId } = await params;
    const caseId = requiredCaseId(new URL(request.url).searchParams.get("caseId"));
    const prisma = getPrisma();
    const existing = await findTag(prisma, tagId, caseId);
    const [eventAssignments, documentAssignments] = await Promise.all([
      prisma.eventTag.count({ where: { tagId: existing.id } }),
      prisma.documentTag.count({ where: { tagId: existing.id } }),
    ]);
    const assignments = eventAssignments + documentAssignments;

    await prisma.$transaction(async (tx) => {
      await tx.tag.delete({ where: { id: existing.id } });
      await tx.auditEntry.create({
        data: {
          caseId,
          entityType: "Tag",
          entityId: existing.id,
          action: "delete",
          summary: `Deleted tag "${existing.name}" and removed ${assignments} assignment${assignments === 1 ? "" : "s"}`,
        },
      });
    });

    await createCaseBackupBestEffort(prisma, caseId, "tag-delete", { tagId });
    return NextResponse.json({ ok: true, tagId, assignmentsRemoved: assignments });
  } catch (error) {
    return tagErrorResponse(error);
  }
}

async function findTag(
  prisma: ReturnType<typeof getPrisma>,
  tagId: string,
  caseId: string,
) {
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, caseId },
    include: tagInclude,
  });
  if (!tag) throw new TagApiError("TAG_NOT_FOUND", 404, "This tag no longer exists.");
  return tag;
}

function requiredCaseId(value: unknown) {
  const caseId = typeof value === "string" ? value.trim() : "";
  if (!caseId) throw new TagApiError("INVALID_REQUEST", 400, "An investigation is required.");
  return caseId;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
    return body as Record<string, unknown>;
  } catch {
    throw new TagApiError("INVALID_REQUEST", 400, "The tag request body is invalid.");
  }
}
