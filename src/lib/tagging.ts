import type { Prisma, PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";

export const MAX_TAG_NAME_LENGTH = 64;
export const DEFAULT_TAG_COLOUR = "#38bdf8";

const TAG_COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;

type TagLookupClient = Pick<PrismaClient, "tag"> | Pick<Prisma.TransactionClient, "tag">;

export class TagApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TagApiError";
  }
}

export function normaliseTagName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function tagNameKey(value: unknown) {
  return normaliseTagName(value).toLowerCase();
}

export function validateTagName(value: unknown) {
  const name = normaliseTagName(value);
  if (!name) {
    throw new TagApiError("INVALID_TAG_NAME", 400, "Enter a tag name.");
  }
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new TagApiError(
      "INVALID_TAG_NAME",
      400,
      `Tag names must be ${MAX_TAG_NAME_LENGTH} characters or fewer.`,
    );
  }
  return { name, normalizedName: tagNameKey(name) };
}

export function validateTagColour(value: unknown) {
  const colour = typeof value === "string" ? value.trim() : "";
  if (!TAG_COLOUR_PATTERN.test(colour)) {
    throw new TagApiError(
      "INVALID_TAG_COLOUR",
      400,
      "Tag colours must use a six-digit hex value such as #38bdf8.",
    );
  }
  return colour.toLowerCase();
}

export function tagIdsFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

export async function validateTagReferences(
  prisma: TagLookupClient,
  caseId: string,
  tagIds: string[],
) {
  if (!tagIds.length) return;
  const count = await prisma.tag.count({
    where: { id: { in: tagIds }, caseId },
  });
  if (count !== tagIds.length) {
    throw new TagApiError(
      "TAG_CASE_MISMATCH",
      403,
      "One or more selected tags do not belong to this investigation.",
    );
  }
}

export function assignmentChanges(previous: string[], next: string[]) {
  const before = new Set(previous);
  const after = new Set(next);
  return {
    added: next.filter((id) => !before.has(id)),
    removed: previous.filter((id) => !after.has(id)),
  };
}

export function assignmentAuditSummary(
  entityLabel: string,
  changes: ReturnType<typeof assignmentChanges>,
) {
  const details = [
    changes.added.length ? `added ${changes.added.length}` : "",
    changes.removed.length ? `removed ${changes.removed.length}` : "",
  ].filter(Boolean);
  return details.length ? `${entityLabel}; tags ${details.join(", ")}` : entityLabel;
}

export function tagErrorResponse(error: unknown) {
  if (error instanceof TagApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002"
  ) {
    return NextResponse.json(
      {
        error: {
          code: "TAG_NAME_CONFLICT",
          message: "A tag with this name already exists in this investigation.",
        },
      },
      { status: 409 },
    );
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2025"
  ) {
    return NextResponse.json(
      {
        error: {
          code: "MATERIAL_NOT_FOUND",
          message: "This item no longer exists. Refresh the investigation and try again.",
        },
      },
      { status: 404 },
    );
  }
  console.error("Tag request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { error: { code: "TAG_REQUEST_FAILED", message: "The tag change could not be saved." } },
    { status: 500 },
  );
}
