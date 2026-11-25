import type { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { createCaseBackup } from "@/lib/backup";
import { evidenceErrorResponse } from "@/lib/evidence-error-response";
import { EvidenceApiError } from "@/lib/evidence-errors";
import { requireEvidenceAuthentication } from "@/lib/evidence-download";
import { getPrisma } from "@/lib/prisma";
import { assignmentAuditSummary, assignmentChanges, tagIdsFromUnknown } from "@/lib/tagging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function eventIdsFromBody(body: { eventIds?: unknown; eventId?: unknown }) {
  const values = Array.isArray(body.eventIds)
    ? body.eventIds
    : body.eventId
      ? [body.eventId]
      : [];
  return [
    ...new Set(values.map((value) => String(value).trim()).filter(Boolean)),
  ];
}

export async function POST(request: Request) {
  try {
    await requireEvidenceAuthentication(request);
    const body = await readBody(request);
    const caseId = requiredString(body.caseId, "A case is required.");
    const eventIds = eventIdsFromBody(body);
    const tagIds = tagIdsFromUnknown(body.tagIds);
    const prisma = getPrisma();
    await validateCaseAndReferences(prisma, caseId, eventIds, tagIds);

    const evidence = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          caseId,
          title:
            optionalString(body.title) ||
            optionalString(body.filename) ||
            "Evidence item",
          filename:
            optionalString(body.filename) ||
            optionalString(body.title) ||
            "Evidence item",
          description: optionalString(body.description),
          sourceType: optionalString(body.sourceType) || "Other",
          sourceReference: optionalString(body.sourceReference),
          confidenceLevel: optionalString(body.confidenceLevel) || "Documented",
          path: "",
          filePath: "",
          fileSize: 0,
          mimeType: "application/octet-stream",
          events: eventIds.length
            ? { create: eventIds.map((eventId) => ({ eventId })) }
            : undefined,
          tags: tagIds.length
            ? { create: tagIds.map((tagId) => ({ tagId })) }
            : undefined,
          people: optionalString(body.personId)
            ? {
                create: [
                  {
                    personId: optionalString(body.personId),
                    role: optionalString(body.personRole) || "Witness",
                  },
                ],
              }
            : undefined,
        },
        include: {
          people: { include: { person: true } },
          events: { include: { event: true } },
          tags: { include: { tag: true } },
        },
      });
      await tx.auditEntry.create({
        data: {
          caseId,
          entityType: "Evidence",
          entityId: created.id,
          action: "create",
          summary: `Created evidence "${created.title}"${tagIds.length ? ` with ${tagIds.length} tag${tagIds.length === 1 ? "" : "s"}` : ""}`,
        },
      });
      return created;
    });

    await bestEffortBackup(prisma, caseId, "evidence-create", evidence.id);
    return NextResponse.json(evidence, { status: 201 });
  } catch (error) {
    return evidenceErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireEvidenceAuthentication(request);
    const body = await readBody(request);
    const id = requiredString(body.id, "An evidence reference is required.");
    const prisma = getPrisma();
    const existing = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        caseId: true,
        title: true,
        filename: true,
        tags: { select: { tagId: true } },
      },
    });
    if (!existing)
      throw new EvidenceApiError(
        "EVIDENCE_NOT_FOUND",
        404,
        "No evidence metadata exists for this document.",
      );
    if (!existing.caseId)
      throw new EvidenceApiError(
        "CASE_ACCESS_DENIED",
        403,
        "This evidence is not attached to an accessible case.",
      );

    const eventIds =
      body.eventIds !== undefined || body.eventId !== undefined
        ? eventIdsFromBody(body)
        : undefined;
    const tagIds = body.tagIds !== undefined ? tagIdsFromUnknown(body.tagIds) : undefined;
    if (eventIds || tagIds) {
      await validateCaseAndReferences(
        prisma,
        existing.caseId,
        eventIds ?? [],
        tagIds ?? [],
      );
    }
    const tagChanges = assignmentChanges(
      existing.tags.map((link) => link.tagId),
      tagIds ?? existing.tags.map((link) => link.tagId),
    );

    const updated = await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id },
        data: {
          title:
            body.title === undefined ? undefined : optionalString(body.title),
          description:
            body.description === undefined
              ? undefined
              : optionalString(body.description),
          sourceType:
            body.sourceType === undefined
              ? undefined
              : optionalString(body.sourceType),
          sourceReference:
            body.sourceReference === undefined
              ? undefined
              : optionalString(body.sourceReference),
          confidenceLevel:
            body.confidenceLevel === undefined
              ? undefined
              : optionalString(body.confidenceLevel),
          deletedAt: body.deleted === true ? new Date() : undefined,
        },
      });

      if (eventIds) {
        await tx.eventDocument.deleteMany({ where: { documentId: id } });
        if (eventIds.length)
          await tx.eventDocument.createMany({
            data: eventIds.map((eventId) => ({ documentId: id, eventId })),
          });
      }
      if (tagIds) {
        await tx.documentTag.deleteMany({ where: { documentId: id } });
        if (tagIds.length) {
          await tx.documentTag.createMany({
            data: tagIds.map((tagId) => ({ documentId: id, tagId })),
          });
        }
      }
      if (body.personId !== undefined) {
        await tx.evidencePerson.deleteMany({ where: { documentId: id } });
        const personId = optionalString(body.personId);
        if (personId) {
          await tx.evidencePerson.create({
            data: {
              documentId: id,
              personId,
              role: optionalString(body.personRole) || "Witness",
            },
          });
        }
      }

      await tx.auditEntry.create({
        data: {
          caseId: existing.caseId!,
          entityType: "Evidence",
          entityId: id,
          action:
            body.deleted === true
              ? "soft-delete"
              : tagChanges.added.length || tagChanges.removed.length
                ? "update-tags"
                : "update",
          summary:
            body.deleted === true
              ? `Soft deleted evidence "${optionalString(body.title) || existing.title || existing.filename}"`
              : assignmentAuditSummary(
                  `Updated evidence "${optionalString(body.title) || existing.title || existing.filename}"`,
                  tagChanges,
                ),
        },
      });
      return tx.document.findUniqueOrThrow({
        where: { id },
        include: {
          people: { include: { person: true } },
          events: { include: { event: true } },
          tags: { include: { tag: true } },
        },
      });
    });

    await bestEffortBackup(
      prisma,
      existing.caseId,
      body.deleted === true ? "evidence-archive" : "evidence-update",
      id,
    );
    return NextResponse.json(updated);
  } catch (error) {
    return evidenceErrorResponse(error);
  }
}

async function validateCaseAndReferences(
  prisma: PrismaClient,
  caseId: string,
  eventIds: string[],
  tagIds: string[],
) {
  const targetCase = await prisma.case.findFirst({
    where: { id: caseId, deletedAt: null },
    select: { id: true },
  });
  if (!targetCase)
    throw new EvidenceApiError(
      "CASE_NOT_FOUND",
      404,
      "The selected case no longer exists.",
    );
  if (eventIds.length) {
    const count = await prisma.event.count({
      where: { id: { in: eventIds }, caseId, deletedAt: null },
    });
    if (count !== eventIds.length) {
      throw new EvidenceApiError(
        "CASE_ACCESS_DENIED",
        403,
        "One or more selected events do not belong to this case.",
      );
    }
  }
  if (tagIds.length) {
    const count = await prisma.tag.count({
      where: { id: { in: tagIds }, caseId },
    });
    if (count !== tagIds.length) {
      throw new EvidenceApiError(
        "CASE_ACCESS_DENIED",
        403,
        "One or more selected tags do not belong to this case.",
      );
    }
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("invalid body");
    return body as Record<string, unknown>;
  } catch (error) {
    throw new EvidenceApiError(
      "INVALID_REQUEST",
      400,
      "The evidence request body is invalid.",
      { cause: error },
    );
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredString(value: unknown, message: string) {
  const text = optionalString(value);
  if (!text) throw new EvidenceApiError("INVALID_REQUEST", 400, message);
  return text;
}

async function bestEffortBackup(
  prisma: PrismaClient,
  caseId: string,
  reason: string,
  documentId: string,
) {
  try {
    await createCaseBackup(prisma, caseId, reason);
  } catch (error) {
    console.error(
      "Evidence change succeeded, but the follow-up case backup failed",
      {
        caseId,
        documentId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    );
  }
}
