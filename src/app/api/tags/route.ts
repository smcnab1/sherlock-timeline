import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";
import {
  DEFAULT_TAG_COLOUR,
  TagApiError,
  tagErrorResponse,
  validateTagColour,
  validateTagName,
} from "@/lib/tagging";

export const dynamic = "force-dynamic";

const tagInclude = {
  _count: {
    select: {
      events: { where: { event: { deletedAt: null } } },
      documents: { where: { document: { deletedAt: null } } },
    },
  },
} as const;

export async function GET(request: Request) {
  try {
    const caseId = requiredCaseId(new URL(request.url).searchParams.get("caseId"));
    const prisma = getPrisma();
    await requireActiveCase(prisma, caseId);
    const tags = await prisma.tag.findMany({
      where: { caseId },
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      include: tagInclude,
    });
    return NextResponse.json(tags);
  } catch (error) {
    return tagErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const caseId = requiredCaseId(body.caseId);
    const { name, normalizedName } = validateTagName(body.name);
    const colour = validateTagColour(body.colour ?? DEFAULT_TAG_COLOUR);
    const prisma = getPrisma();
    await requireActiveCase(prisma, caseId);

    const created = await prisma.$transaction(async (tx) => {
      const tag = await tx.tag.create({
        data: { caseId, name, normalizedName, colour },
        include: tagInclude,
      });
      await tx.auditEntry.create({
        data: {
          caseId,
          entityType: "Tag",
          entityId: tag.id,
          action: "create",
          summary: `Created tag "${tag.name}"`,
        },
      });
      return tag;
    });

    await createCaseBackupBestEffort(prisma, caseId, "tag-create", { tagId: created.id });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return tagErrorResponse(error);
  }
}

async function requireActiveCase(
  prisma: ReturnType<typeof getPrisma>,
  caseId: string,
) {
  const investigation = await prisma.case.findFirst({
    where: { id: caseId, deletedAt: null },
    select: { id: true },
  });
  if (!investigation) {
    throw new TagApiError("CASE_NOT_FOUND", 404, "The selected investigation no longer exists.");
  }
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
