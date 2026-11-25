import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getCaseWorkspace } from "@/lib/data";
import { getPrisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspace = await getCaseWorkspace(searchParams.get("caseId") || undefined);

  return NextResponse.json(workspace);
}

export async function POST(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();

  const createdCase = await prisma.case.create({
    data: {
      title: body.title || "Untitled case",
      description: body.description || "",
      status: body.status || "active",
    },
  });

  return NextResponse.json(createdCase);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();

  const updatedCase = await prisma.case.update({
    where: { id: body.id },
    data: {
      title: body.title,
      description: body.description,
      status: body.status,
      deletedAt: body.archived === true ? new Date() : body.archived === false ? null : undefined,
    },
  });

  await prisma.auditEntry.create({
    data: {
      caseId: updatedCase.id,
      entityType: "Case",
      entityId: updatedCase.id,
      action: body.archived === true ? "archive" : "update",
      summary: `${body.archived === true ? "Archived" : "Updated"} investigation "${updatedCase.title}"`,
    },
  });
  await createCaseBackupBestEffort(prisma, updatedCase.id, body.archived === true ? "case-archive" : "case-update");

  return NextResponse.json(updatedCase);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const caseId = searchParams.get("caseId");

  if (!caseId) {
    return NextResponse.json({ error: "caseId is required" }, { status: 400 });
  }

  const prisma = getPrisma();
  await prisma.case.delete({ where: { id: caseId } });

  return NextResponse.json({ ok: true, caseId });
}
