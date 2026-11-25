import { PrismaClient } from "@prisma/client";
import {
  createRuntimeEvidenceStorageForLocator,
  isBlobStoragePath,
  StorageError,
} from "../src/lib/runtime-storage";

const checkStorage = process.argv.includes("--check-storage");
const prisma = new PrismaClient();

type DiagnosticStatus =
  | "blob-reference"
  | "local-reference"
  | "metadata-only"
  | "available"
  | "stored-object-missing"
  | "storage-not-configured"
  | "storage-authentication-failed"
  | "storage-provider-failure";

async function main() {
  const documents = await prisma.document.findMany({
    orderBy: { uploadedAt: "asc" },
    select: {
      id: true,
      caseId: true,
      filePath: true,
      path: true,
      deletedAt: true,
    },
  });
  const results: Array<{
    documentId: string;
    caseId: string | null;
    recordState: "active" | "archived";
    referenceType: "vercel-blob" | "local-filesystem" | "none";
    applicationPathType:
      "uploads-route" | "document-download-route" | "empty" | "other";
    status: DiagnosticStatus;
  }> = [];

  for (const document of documents) {
    const referenceType = !document.filePath
      ? "none"
      : isBlobStoragePath(document.filePath)
        ? "vercel-blob"
        : "local-filesystem";
    let status: DiagnosticStatus =
      referenceType === "none"
        ? "metadata-only"
        : referenceType === "vercel-blob"
          ? "blob-reference"
          : "local-reference";

    if (checkStorage && document.filePath) {
      try {
        const storage = createRuntimeEvidenceStorageForLocator(
          document.filePath,
        );
        const object = await storage.get(document.filePath);
        await object.stream.cancel();
        status = "available";
      } catch (error) {
        status = diagnosticStatus(error);
      }
    }

    results.push({
      documentId: document.id,
      caseId: document.caseId,
      recordState: document.deletedAt ? "archived" : "active",
      referenceType,
      applicationPathType: !document.path
        ? "empty"
        : document.path.startsWith("/uploads/")
          ? "uploads-route"
          : document.path.startsWith("/api/evidence/")
            ? "document-download-route"
            : "other",
      status,
    });
  }

  const counts = results.reduce<Record<string, number>>((summary, result) => {
    summary[result.status] = (summary[result.status] ?? 0) + 1;
    return summary;
  }, {});

  console.log(
    JSON.stringify(
      {
        dryRun: true,
        checkedStoredObjects: checkStorage,
        total: results.length,
        counts,
        records: results,
      },
      null,
      2,
    ),
  );

  if (
    results.some((result) =>
      [
        "stored-object-missing",
        "storage-authentication-failed",
        "storage-provider-failure",
      ].includes(result.status),
    )
  ) {
    process.exitCode = 2;
  }
}

function diagnosticStatus(error: unknown): DiagnosticStatus {
  if (!(error instanceof StorageError)) return "storage-provider-failure";
  if (
    error.code === "STORED_OBJECT_MISSING" ||
    error.code === "INVALID_STORAGE_PATH"
  )
    return "stored-object-missing";
  if (error.code === "STORAGE_NOT_CONFIGURED") return "storage-not-configured";
  if (error.code === "STORAGE_AUTHENTICATION_FAILED")
    return "storage-authentication-failed";
  return "storage-provider-failure";
}

main()
  .catch((error) => {
    console.error("Evidence diagnostic failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
