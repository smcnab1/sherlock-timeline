import { NextResponse } from "next/server";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";

function normalizeSubject(value: string) {
  return value
    .toLowerCase()
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function eventIdsFromBody(body: { eventIds?: unknown }) {
  return [
    ...new Set(
      (Array.isArray(body.eventIds) ? body.eventIds : [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
}

export async function POST(request: Request) {
  const body = await request.json();
  const prisma = getPrisma();
  const caseId = String(body.caseId || "").trim();
  const eventIds = eventIdsFromBody(body);
  const existingConversationId = String(body.conversationId || "").trim();

  if (!caseId || eventIds.length === 0) {
    return NextResponse.json(
      { error: "caseId and at least one event are required" },
      { status: 400 },
    );
  }

  const updated = await prisma.$transaction(
    async (tx) => {
      const events = await tx.event.findMany({
        where: { id: { in: eventIds }, caseId, deletedAt: null },
        orderBy: { startDate: "asc" },
        include: { people: true },
      });

      if (events.length !== eventIds.length) {
        return null;
      }

      if (
        existingConversationId &&
        !(await tx.conversation.findFirst({
          where: { id: existingConversationId, caseId },
          select: { id: true },
        }))
      )
        return null;

      const first = events[0];
      const last = events[events.length - 1];
      const participantIds = new Set(
        events.flatMap((event) =>
          event.people.map((person) => person.personId),
        ),
      );
      const title = String(
        body.title || first.title || "Manual conversation",
      ).trim();

      const conversation = existingConversationId
        ? await tx.conversation.update({
            where: { id: existingConversationId, caseId },
            data: {
              title: title || undefined,
              normalizedSubject: title ? normalizeSubject(title) : undefined,
              startedAt: first.startDate,
              endedAt: last.startDate,
              participantCount: participantIds.size,
            },
          })
        : await tx.conversation.create({
            data: {
              caseId,
              title,
              normalizedSubject: normalizeSubject(title),
              status: String(body.status || "active"),
              startedAt: first.startDate,
              endedAt: last.startDate,
              messageCount: 0,
              participantCount: participantIds.size,
            },
          });

      await tx.event.updateMany({
        where: { id: { in: events.map((event) => event.id) }, caseId },
        data: { conversationId: conversation.id },
      });

      await tx.auditEntry.create({
        data: {
          caseId,
          entityType: "Conversation",
          entityId: conversation.id,
          action: existingConversationId ? "update" : "create",
          summary: `${existingConversationId ? "Linked events to" : "Created"} conversation "${conversation.title}"`,
        },
      });

      return tx.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        include: {
          messages: {
            orderBy: { sentAt: "asc" },
            take: 12,
          },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );

  if (!updated)
    return NextResponse.json(
      {
        error:
          "The conversation or selected events are unavailable in this case.",
      },
      { status: 404 },
    );
  await createCaseBackupBestEffort(prisma, caseId, "conversation-link");
  return NextResponse.json(updated);
}
