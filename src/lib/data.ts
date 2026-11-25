import { getPrisma } from "@/lib/prisma";
import type { CaseInsight } from "@/lib/types";

type WorkspaceEvent = {
  id: string;
  title: string;
  eventType: string;
  category: string;
  status: string;
  startDate: Date;
  documents: { document: { id: string; uploadedAt: Date } }[];
};

type WorkspaceAction = {
  id: string;
  title: string;
  status: string;
  dueDate: Date;
};

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function generateInsights(events: WorkspaceEvent[], actions: WorkspaceAction[]) {
  const insights: CaseInsight[] = [];
  const sorted = [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const now = new Date();

  sorted.forEach((event, index) => {
    const next = sorted[index + 1];
    if (!next) return;
    const gap = daysBetween(event.startDate, next.startDate);
    if (gap >= 14) {
      insights.push({
        id: `gap-${event.id}-${next.id}`,
        severity: gap >= 30 ? "critical" : "warning",
        title: "Significant communication gap",
        detail: `${gap} days passed between "${event.title}" and "${next.title}".`,
      });
    }
  });

  const responseTargets = new Set(
    sorted
      .filter((event) => /response|acknowledg/i.test(event.title + event.category))
      .map((event) => event.id),
  );
  sorted
    .filter((event) => /request|referral|follow.?up|sent/i.test(event.title + event.category))
    .forEach((event) => {
      const nextResponse = sorted.find(
        (candidate) =>
          candidate.startDate > event.startDate &&
          responseTargets.has(candidate.id),
      );
      if (!nextResponse && daysBetween(event.startDate, now) >= 14) {
        insights.push({
          id: `unanswered-${event.id}`,
          severity: "warning",
          title: "No management response for 14 days",
          detail: `"${event.title}" has no later recorded response event.`,
        });
      }
    });

  actions
    .filter((action) => !["Completed", "Cancelled"].includes(action.status))
    .forEach((action) => {
      const overdueDays = daysBetween(action.dueDate, now);
      if (overdueDays > 30) {
        insights.push({
          id: `old-action-${action.id}`,
          severity: "critical",
          title: "Outstanding action older than 30 days",
          detail: `"${action.title}" is ${overdueDays} days overdue.`,
        });
      } else if (overdueDays > 0) {
        insights.push({
          id: `overdue-action-${action.id}`,
          severity: "warning",
          title: "Overdue action",
          detail: `"${action.title}" is ${overdueDays} days overdue.`,
        });
      }
    });

  const evidenceByDay = sorted.reduce<Record<string, number>>((acc, event) => {
    const key = event.startDate.toISOString().slice(0, 10);
    acc[key] = (acc[key] ?? 0) + event.documents.length;
    return acc;
  }, {});
  Object.entries(evidenceByDay)
    .filter(([, count]) => count >= 4)
    .forEach(([date, count]) => {
      insights.push({
        id: `evidence-density-${date}`,
        severity: "notice",
        title: "High evidence density",
        detail: `${count} evidence links cluster around ${date}.`,
      });
    });

  return insights.slice(0, 8);
}

export async function getCaseWorkspace(caseId?: string) {
  const prisma = getPrisma();

  const cases = await prisma.case.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          events: { where: { deletedAt: null } },
          documents: { where: { deletedAt: null } },
          actions: { where: { deletedAt: null } },
        },
      },
    },
  });

  const selectedCaseId = caseId ?? cases.find((item) => !item.deletedAt)?.id ?? cases[0]?.id;

  const activeCase = selectedCaseId
    ? await prisma.case.findUnique({
        where: { id: selectedCaseId },
        include: {
          events: {
            where: { deletedAt: null },
            orderBy: { startDate: "asc" },
            include: {
              people: { include: { person: true } },
              documents: {
                include: {
                  document: { include: { tags: { include: { tag: true } } } },
                },
              },
              tags: { include: { tag: true } },
              conversation: { select: { id: true, title: true, status: true } },
              outgoing: true,
              incoming: true,
              actions: {
                where: { deletedAt: null },
                include: {
                  owner: true,
                  evidence: { include: { tags: { include: { tag: true } } } },
                },
              },
            },
          },
          documents: {
            where: { deletedAt: null },
            orderBy: { uploadedAt: "desc" },
            include: {
              people: { include: { person: true } },
              events: { include: { event: true } },
              tags: { include: { tag: true } },
            },
          },
          actions: {
            where: { deletedAt: null },
            orderBy: { dueDate: "asc" },
            include: {
              owner: true,
              event: true,
              evidence: { include: { tags: { include: { tag: true } } } },
            },
          },
        },
      })
    : null;

  // Prisma omits undefined filters. An unknown case must yield empty
  // case-scoped collections rather than querying the whole workspace.
  if (!activeCase) return {
    activeCase: null, cases, people: [], evidence: [], actions: [], tags: [], relationships: [],
    personRelationships: [], auditTrail: [], backups: [], conversations: [], importJobs: [], insights: [],
  };

  const activeEventIds = activeCase?.events.map((event) => event.id) ?? [];

  const [people, evidence, actions, rawTags, relationships, personRelationships, auditTrail, backups, conversations, importJobs] = await Promise.all([
    prisma.person.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: { outgoing: true, incoming: true },
    }),
    prisma.document.findMany({
      where: { caseId: activeCase?.id, deletedAt: null },
      orderBy: { uploadedAt: "desc" },
      include: {
        people: { include: { person: true } },
        events: { include: { event: true } },
        tags: { include: { tag: true } },
      },
    }),
    prisma.action.findMany({
      where: { caseId: activeCase?.id, deletedAt: null },
      orderBy: { dueDate: "asc" },
      include: {
        owner: true,
        event: true,
        evidence: { include: { tags: { include: { tag: true } } } },
      },
    }),
    prisma.tag.findMany({
      where: activeCase?.id ? { caseId: activeCase.id } : { id: "__none__" },
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
      include: {
        _count: {
          select: {
            events: true,
            documents: true,
          },
        },
      },
    }),
    prisma.relationship.findMany({
      where: activeEventIds.length
        ? { sourceId: { in: activeEventIds }, targetId: { in: activeEventIds } }
        : { id: "__none__" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.personRelationship.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.auditEntry.findMany({
      where: { caseId: activeCase?.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.backup.findMany({
      where: { caseId: activeCase?.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.conversation.findMany({
      where: { caseId: activeCase?.id },
      orderBy: { startedAt: "desc" },
      include: {
        messages: {
          orderBy: { sentAt: "asc" },
          take: 12,
        },
      },
    }),
    prisma.importJob.findMany({
      where: { caseId: activeCase?.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const activeEventTagCounts = new Map<string, number>();
  for (const event of activeCase?.events ?? []) {
    for (const link of event.tags) {
      activeEventTagCounts.set(link.tagId, (activeEventTagCounts.get(link.tagId) ?? 0) + 1);
    }
  }
  const activeDocumentTagCounts = new Map<string, number>();
  for (const document of evidence) {
    for (const link of document.tags) {
      activeDocumentTagCounts.set(link.tagId, (activeDocumentTagCounts.get(link.tagId) ?? 0) + 1);
    }
  }
  const tags = rawTags.map((tag) => ({
    ...tag,
    assignmentCount: tag._count.events + tag._count.documents,
    _count: {
      events: activeEventTagCounts.get(tag.id) ?? 0,
      documents: activeDocumentTagCounts.get(tag.id) ?? 0,
    },
  }));

  return {
    activeCase,
    cases,
    people,
    evidence,
    actions,
    tags,
    relationships,
    personRelationships,
    auditTrail,
    backups,
    conversations,
    importJobs,
    insights: activeCase ? generateInsights(activeCase.events, actions) : [],
  };
}
