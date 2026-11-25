import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { runtimeStorageDir } from "@/lib/runtime-storage";

export async function createCaseBackup(
  prisma: PrismaClient,
  caseId: string,
  reason: string,
) {
  const item = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      events: {
        include: {
          people: true,
          documents: true,
          tags: true,
          outgoing: true,
          incoming: true,
          actions: true,
        },
      },
      documents: {
        include: { people: true, events: true, tags: true, actions: true },
      },
      actions: true,
      auditTrail: true,
      tags: true,
    },
  });

  if (!item) return null;

  const dir = runtimeStorageDir("backups");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${randomUUID()}.json`);
  await writeFile(
    filePath,
    JSON.stringify(
      { backedUpAt: new Date().toISOString(), reason, case: item },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );

  try {
    return await prisma.backup.create({ data: { caseId, path: filePath } });
  } catch (error) {
    await unlink(filePath);
    throw error;
  }
}

export async function createCaseBackupBestEffort(
  prisma: PrismaClient,
  caseId: string,
  reason: string,
  context: Record<string, string> = {},
) {
  try {
    await createCaseBackup(prisma, caseId, reason);
  } catch (error) {
    console.error(
      "Material change succeeded, but the follow-up case backup failed",
      {
        caseId,
        reason,
        ...context,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    );
  }
}
