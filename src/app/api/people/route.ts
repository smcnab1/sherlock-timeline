import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();

  const person = await prisma.person.create({
    data: {
      name: body.name,
      role: body.role || "",
      organisation: body.organisation || "",
      notes: body.notes || "",
    },
  });

  if (body.caseId) {
    await prisma.auditEntry.create({
      data: {
        caseId: body.caseId,
        entityType: "Person",
        entityId: person.id,
        action: "create",
        summary: `Created person "${person.name}"`,
      },
    });
    await createCaseBackupBestEffort(prisma, body.caseId, "person-create");
  }

  return NextResponse.json(person);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();

  const person = await prisma.person.update({
    where: { id: body.id },
    data: {
      name: body.name,
      role: body.role,
      organisation: body.organisation,
      notes: body.notes,
      deletedAt: body.deleted ? new Date() : undefined,
    },
    include: { outgoing: true, incoming: true },
  });

  if (body.caseId) {
    await prisma.auditEntry.create({
      data: {
        caseId: body.caseId,
        entityType: "Person",
        entityId: person.id,
        action: body.deleted ? "soft-delete" : "update",
        summary: `${body.deleted ? "Soft deleted" : "Updated"} person "${person.name}"`,
      },
    });
    await createCaseBackupBestEffort(prisma, body.caseId, body.deleted ? "person-archive" : "person-update");
  }

  return NextResponse.json(person);
}
