import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";

async function referencesBelongToCase(
  tx: Prisma.TransactionClient,
  caseId: string,
  eventId: unknown,
  documentId: unknown,
) {
  if (
    eventId &&
    (typeof eventId !== "string" ||
      !(await tx.event.findFirst({
        where: { id: eventId, caseId, deletedAt: null },
        select: { id: true },
      })))
  )
    return false;
  if (
    documentId &&
    (typeof documentId !== "string" ||
      !(await tx.document.findFirst({
        where: { id: documentId, caseId, deletedAt: null },
        select: { id: true },
      })))
  )
    return false;
  return true;
}

function unavailableReference() {
  return NextResponse.json(
    { error: "The action or linked material is unavailable in this case." },
    { status: 404 },
  );
}

export async function POST(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();

  if (typeof body.caseId !== "string" || !body.caseId)
    return unavailableReference();
  const action = await prisma.$transaction(async (tx) => {
    if (
      !(await referencesBelongToCase(
        tx,
        body.caseId,
        body.eventId,
        body.documentId,
      ))
    )
      return null;
    const action = await tx.action.create({
      data: {
        caseId: body.caseId,
        title: body.title,
        description: body.description || "",
        ownerId: body.ownerId || null,
        dueDate: new Date(body.dueDate),
        status: body.status || "Open",
        eventId: body.eventId || null,
        documentId: body.documentId || null,
      },
      include: { owner: true, event: true, evidence: true },
    });

    await tx.auditEntry.create({
      data: {
        caseId: action.caseId,
        entityType: "Action",
        entityId: action.id,
        action: "create",
        summary: `Created action "${action.title}"`,
      },
    });
    return action;
  });
  if (!action) return unavailableReference();
  await createCaseBackupBestEffort(prisma, action.caseId, "action-create");

  return NextResponse.json(action);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();

  if (typeof body.id !== "string" || !body.id) return unavailableReference();
  const action = await prisma.$transaction(async (tx) => {
    const existing = await tx.action.findUnique({
      where: { id: body.id },
      select: { caseId: true },
    });
    if (
      !existing ||
      !(await referencesBelongToCase(
        tx,
        existing.caseId,
        body.eventId,
        body.documentId,
      ))
    )
      return null;
    const action = await tx.action.update({
      where: { id: body.id },
      data: {
        title: body.title,
        description: body.description,
        ownerId: body.ownerId === "" ? null : body.ownerId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        status: body.status,
        eventId: body.eventId === "" ? null : body.eventId,
        documentId: body.documentId === "" ? null : body.documentId,
        deletedAt: body.deleted ? new Date() : undefined,
      },
      include: { owner: true, event: true, evidence: true },
    });

    await tx.auditEntry.create({
      data: {
        caseId: action.caseId,
        entityType: "Action",
        entityId: action.id,
        action: body.deleted ? "soft-delete" : "update",
        summary: `${body.deleted ? "Soft deleted" : "Updated"} action "${action.title}"`,
      },
    });
    return action;
  });
  if (!action) return unavailableReference();
  await createCaseBackupBestEffort(
    prisma,
    action.caseId,
    body.deleted ? "action-archive" : "action-update",
  );

  return NextResponse.json(action);
}
