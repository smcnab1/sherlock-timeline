import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";

const inverseRelationshipTypes: Record<string, string> = {
  Manager: "Direct Report",
  "Direct Report": "Manager",
  "Reports To": "Manager",
  Witness: "Witnessed By",
  "Witnessed By": "Witness",
  Mentor: "Mentee",
  Mentee: "Mentor",
  "Parent Event": "Child Event",
  "Child Event": "Parent Event",
  "Line Manager": "Direct Report",
  "Senior Manager": "Direct Report",
  HR: "Supported By HR",
  "Supported By HR": "HR",
};

export async function POST(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();
  const relationshipType = body.relationshipType || "Other";
  const inverseType = inverseRelationshipTypes[relationshipType] ?? relationshipType;

  const [relationship, inverseRelationship] = await prisma.$transaction([
    prisma.personRelationship.upsert({
      where: {
        sourceId_targetId_relationshipType: {
          sourceId: body.sourceId,
          targetId: body.targetId,
          relationshipType,
        },
      },
      create: {
        sourceId: body.sourceId,
        targetId: body.targetId,
        relationshipType,
        notes: body.notes || "",
      },
      update: {
        notes: body.notes || "",
      },
    }),
    prisma.personRelationship.upsert({
      where: {
        sourceId_targetId_relationshipType: {
          sourceId: body.targetId,
          targetId: body.sourceId,
          relationshipType: inverseType,
        },
      },
      create: {
        sourceId: body.targetId,
        targetId: body.sourceId,
        relationshipType: inverseType,
        notes: body.notes || "",
      },
      update: {
        notes: body.notes || "",
      },
    }),
  ]);

  if (body.caseId) {
    await prisma.auditEntry.create({
      data: {
        caseId: body.caseId,
        entityType: "PersonRelationship",
        entityId: relationship.id,
        action: "upsert",
        summary: `Linked people as ${relationship.relationshipType}`,
      },
    });
    await createCaseBackupBestEffort(prisma, body.caseId, "person-relationship-upsert");
  }

  return NextResponse.json([relationship, inverseRelationship]);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();
  const relationshipType = body.relationshipType || "Other";
  const inverseType = inverseRelationshipTypes[relationshipType] ?? relationshipType;

  const current = await prisma.personRelationship.findUniqueOrThrow({
    where: { id: body.id },
  });
  const oldInverseType = inverseRelationshipTypes[current.relationshipType] ?? current.relationshipType;

  const [relationship, inverseRelationship] = await prisma.$transaction(async (tx) => {
    await tx.personRelationship.deleteMany({
      where: {
        sourceId: current.targetId,
        targetId: current.sourceId,
        relationshipType: oldInverseType,
      },
    });

    const updated = await tx.personRelationship.update({
      where: { id: body.id },
      data: {
        sourceId: body.sourceId || current.sourceId,
        targetId: body.targetId || current.targetId,
        relationshipType,
        notes: body.notes || "",
      },
    });

    const inverse = await tx.personRelationship.upsert({
      where: {
        sourceId_targetId_relationshipType: {
          sourceId: updated.targetId,
          targetId: updated.sourceId,
          relationshipType: inverseType,
        },
      },
      create: {
        sourceId: updated.targetId,
        targetId: updated.sourceId,
        relationshipType: inverseType,
        notes: body.notes || "",
      },
      update: {
        notes: body.notes || "",
      },
    });

    return [updated, inverse];
  });

  if (body.caseId) {
    await prisma.auditEntry.create({
      data: {
        caseId: body.caseId,
        entityType: "PersonRelationship",
        entityId: relationship.id,
        action: "update",
        summary: `Updated people relationship to ${relationship.relationshipType}`,
      },
    });
    await createCaseBackupBestEffort(prisma, body.caseId, "person-relationship-update");
  }

  return NextResponse.json([relationship, inverseRelationship]);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const caseId = searchParams.get("caseId");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const prisma = getPrisma();
  const relationship = await prisma.personRelationship.findUniqueOrThrow({ where: { id } });
  const inverseType = inverseRelationshipTypes[relationship.relationshipType] ?? relationship.relationshipType;

  await prisma.$transaction([
    prisma.personRelationship.delete({ where: { id } }),
    prisma.personRelationship.deleteMany({
      where: {
        sourceId: relationship.targetId,
        targetId: relationship.sourceId,
        relationshipType: inverseType,
      },
    }),
  ]);

  if (caseId) {
    await prisma.auditEntry.create({
      data: {
        caseId,
        entityType: "PersonRelationship",
        entityId: id,
        action: "delete",
        summary: `Deleted people relationship ${relationship.relationshipType}`,
      },
    });
    await createCaseBackupBestEffort(prisma, caseId, "person-relationship-delete");
  }

  return NextResponse.json({ ok: true, relationship });
}
