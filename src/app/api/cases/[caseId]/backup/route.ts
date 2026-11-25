import { NextResponse } from "next/server";
import { createCaseBackup } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const prisma = getPrisma();
  const backup = await createCaseBackup(prisma, caseId, "manual");

  if (!backup) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  await prisma.auditEntry.create({
    data: {
      caseId,
      entityType: "Backup",
      entityId: backup.id,
      action: "create",
      summary: "Created case backup",
    },
  });

  return NextResponse.json({ id: backup.id, caseId, createdAt: backup.createdAt });
}
