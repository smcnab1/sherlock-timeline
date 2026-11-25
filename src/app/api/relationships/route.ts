import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

const inverseRelationshipTypes = new Map([
  ["Parent Event", "Child Event"],
  ["Child Event", "Parent Event"],
  ["followed-by", "follows"],
  ["follows", "followed-by"],
  ["linked-to", "linked-to"],
]);

type Link = { sourceId: string; targetId: string; relationshipType: string };

function inverseOf(link: Link): Link | null {
  const relationshipType = inverseRelationshipTypes.get(link.relationshipType);
  if (!relationshipType || link.sourceId === link.targetId) return null;
  return { sourceId: link.targetId, targetId: link.sourceId, relationshipType };
}

function writeLink(tx: Prisma.TransactionClient, link: Link) {
  return tx.relationship.upsert({
    where: { sourceId_targetId_relationshipType: link },
    create: link,
    update: {},
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();
  const relationshipType = body.relationshipType || "linked-to";
  const { sourceId, targetId } = body;
  if (
    typeof sourceId !== "string" ||
    typeof targetId !== "string" ||
    typeof relationshipType !== "string"
  ) {
    return NextResponse.json(
      { error: "Valid event IDs and relationship type are required" },
      { status: 400 },
    );
  }
  const links = await prisma.$transaction(async (tx) => {
    const ids = [...new Set([sourceId, targetId])];
    const events = await tx.event.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { caseId: true },
    });
    if (
      events.length !== ids.length ||
      events.some((event) => event.caseId !== events[0].caseId)
    )
      return null;

    const link = { sourceId, targetId, relationshipType };
    const links = [await writeLink(tx, link)];
    const inverse = inverseOf(link);
    if (inverse) links.push(await writeLink(tx, inverse));
    return links;
  });
  if (!links)
    return NextResponse.json(
      { error: "Both events must belong to the same case" },
      { status: 400 },
    );
  return NextResponse.json(links);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();
  const relationshipType = body.relationshipType || "linked-to";

  if (typeof body.id !== "string" || typeof relationshipType !== "string") {
    return NextResponse.json(
      { error: "Valid relationship ID and type are required" },
      { status: 400 },
    );
  }
  const relationship = await prisma.$transaction(
    async (tx) => {
      const current = await tx.relationship.findUnique({
        where: { id: body.id },
      });
      if (!current) return null;
      const previousInverse = inverseOf(current);
      if (previousInverse && current.relationshipType !== relationshipType) {
        await tx.relationship.deleteMany({ where: previousInverse });
      }
      const updated = await tx.relationship.update({
        where: { id: current.id },
        data: { relationshipType },
      });
      const inverse = inverseOf(updated);
      if (inverse) await writeLink(tx, inverse);
      return updated;
    },
    { isolationLevel: "Serializable" },
  );
  if (!relationship)
    return NextResponse.json(
      { error: "Relationship not found" },
      { status: 404 },
    );

  return NextResponse.json(relationship);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const prisma = getPrisma();
  const relationship = await prisma.$transaction(async (tx) => {
    const removed = await tx.relationship.delete({ where: { id } });
    const inverse = inverseOf(removed);
    if (inverse) await tx.relationship.deleteMany({ where: inverse });
    return removed;
  });

  return NextResponse.json({ ok: true, relationship });
}
