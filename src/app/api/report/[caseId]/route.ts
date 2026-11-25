import { NextResponse } from "next/server";
import { differenceInHours } from "date-fns";
import { getPrisma } from "@/lib/prisma";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const prisma = getPrisma();

  const item = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      documents: {
        where: { deletedAt: null },
        orderBy: { uploadedAt: "asc" },
        include: {
          people: { include: { person: true } },
          events: { where: { event: { caseId, deletedAt: null } }, include: { event: true } },
          tags: { where: { tag: { caseId } }, include: { tag: true } },
        },
      },
      actions: {
        where: { deletedAt: null },
        orderBy: { dueDate: "asc" },
        include: { owner: true, event: true, evidence: true },
      },
      events: {
        where: { deletedAt: null },
        orderBy: { startDate: "asc" },
        include: {
          people: { include: { person: true } },
          documents: { where: { document: { caseId, deletedAt: null } }, include: { document: true } },
          tags: { where: { tag: { caseId } }, include: { tag: true } },
          outgoing: true,
        },
      },
    },
  });

  if (!item) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const responsePairs = item.events.flatMap((event) =>
    event.outgoing
      .filter((relationship) => /respond|request|acknowledg/i.test(relationship.relationshipType))
      .map((relationship) => {
        const target = item.events.find((candidate) => candidate.id === relationship.targetId);
        return target
          ? {
              source: event,
              target,
              hours: differenceInHours(target.startDate, event.startDate),
              type: relationship.relationshipType,
            }
          : null;
      })
      .filter((pair): pair is NonNullable<typeof pair> => Boolean(pair)),
  );
  const avgResponse = responsePairs.length
    ? Math.round(responsePairs.reduce((total, pair) => total + pair.hours, 0) / responsePairs.length)
    : 0;
  const longestResponse = responsePairs.length ? Math.max(...responsePairs.map((pair) => pair.hours)) : 0;
  const openActions = item.actions
    .filter((action) => !["Completed", "Cancelled"].includes(action.status))
    .map((action) => ({
      ...action,
      event: action.event?.caseId === caseId && !action.event.deletedAt ? action.event : null,
      evidence: action.evidence?.caseId === caseId && !action.evidence.deletedAt ? action.evidence : null,
    }));

  const html = `<!doctype html>
<html>
<head>
  <title>${escapeHtml(item.title)} - Sherlock Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 38px; line-height: 1.45; }
    button { border: 0; background: #0369a1; color: white; padding: 9px 13px; border-radius: 4px; }
    h1 { margin: 18px 0 4px; font-size: 32px; }
    h2 { margin-top: 30px; border-bottom: 2px solid #0f172a; padding-bottom: 5px; }
    h3 { margin-bottom: 4px; }
    .meta { color: #475569; margin-bottom: 24px; }
    .summary { background: #f1f5f9; border-left: 4px solid #0369a1; padding: 14px 16px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
    .metric { border: 1px solid #cbd5e1; padding: 10px; }
    .metric strong { display: block; font-size: 22px; }
    .event { border-top: 1px solid #cbd5e1; padding: 14px 0; page-break-inside: avoid; }
    .date { font-family: monospace; color: #0369a1; font-weight: 700; }
    .badge { display: inline-block; margin-right: 6px; padding: 3px 7px; background: #e2e8f0; border-radius: 4px; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; page-break-inside: auto; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #e2e8f0; }
    @media print { button { display: none; } body { margin: 18mm; } h2 { break-after: avoid; } .event, tr { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <button onclick="window.print()">Print / Save as PDF</button>
  <h1>${escapeHtml(item.title)}</h1>
  <div class="meta">${escapeHtml(item.status)} | Generated ${escapeHtml(new Date().toLocaleString())}</div>

  <h2>1. Executive Summary</h2>
  <div class="summary">${escapeHtml(item.description)}</div>
  <div class="grid">
    <div class="metric"><strong>${item.events.length}</strong> chronology events</div>
    <div class="metric"><strong>${item.documents.length}</strong> evidence items</div>
    <div class="metric"><strong>${openActions.length}</strong> outstanding actions</div>
    <div class="metric"><strong>${avgResponse}</strong> average response hours</div>
  </div>

  <h2>2. Chronology</h2>
  ${item.events
    .map(
      (event) => `<section class="event">
        <div class="date">${escapeHtml(event.startDate.toUTCString())}</div>
        <h3>${escapeHtml(event.title)}</h3>
        <p><span class="badge">${escapeHtml(event.eventType)}</span><span class="badge">${escapeHtml(event.category)}</span></p>
        <p>${escapeHtml(event.description)}</p>
        <p><strong>People:</strong> ${escapeHtml(event.people.map((p) => p.person.name).join(", ") || "None recorded")}</p>
        <p><strong>Evidence:</strong> ${escapeHtml(event.documents.map((d) => d.document.title || d.document.filename).join(", ") || "None attached")}</p>
        <p>${event.tags.map((t) => `<span class="badge">${escapeHtml(t.tag.name)}</span>`).join("")}</p>
      </section>`,
    )
    .join("")}

  <h2>3. Key Milestones</h2>
  ${item.events
    .filter((event) => event.eventType === "milestone" || event.importance === "critical")
    .map((event) => `<p><strong>${escapeHtml(event.startDate.toUTCString())}</strong> ${escapeHtml(event.title)}</p>`)
    .join("") || "<p>No milestones recorded.</p>"}

  <h2>4. Stakeholders</h2>
  <table><thead><tr><th>Name</th><th>Role</th><th>Organisation</th><th>Event count</th></tr></thead><tbody>
  ${Array.from(new Map(item.events.flatMap((event) => event.people.map((person) => [person.person.id, person.person] as const))).values())
    .map((person) => `<tr><td>${escapeHtml(person.name)}</td><td>${escapeHtml(person.role)}</td><td>${escapeHtml(person.organisation)}</td><td>${item.events.filter((event) => event.people.some((link) => link.personId === person.id)).length}</td></tr>`)
    .join("")}
  </tbody></table>

  <h2>5. Evidence Register</h2>
  <table><thead><tr><th>Title</th><th>Source</th><th>Confidence</th><th>Tags</th><th>Reference</th><th>Linked Events</th></tr></thead><tbody>
  ${item.documents
    .map((document) => `<tr><td>${escapeHtml(document.title || document.filename)}</td><td>${escapeHtml(document.sourceType)}</td><td>${escapeHtml(document.confidenceLevel)}</td><td>${escapeHtml(document.tags.map((link) => link.tag.name).join(", ") || "None")}</td><td>${escapeHtml(document.sourceReference || document.path)}</td><td>${escapeHtml(document.events.map((link) => link.event.title).join(", ") || "Independent")}</td></tr>`)
    .join("")}
  </tbody></table>

  <h2>6. Outstanding Actions</h2>
  <table><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th><th>Links</th></tr></thead><tbody>
  ${openActions
    .map((action) => `<tr><td>${escapeHtml(action.title)}</td><td>${escapeHtml(action.owner?.name || "Unassigned")}</td><td>${escapeHtml(action.dueDate.toUTCString())}</td><td>${escapeHtml(action.status)}</td><td>${escapeHtml([action.event?.title, action.evidence?.title].filter(Boolean).join(" | "))}</td></tr>`)
    .join("") || "<tr><td colspan='5'>No outstanding actions.</td></tr>"}
  </tbody></table>

  <h2>7. Response Analysis</h2>
  <p>Average response time: <strong>${avgResponse} hours</strong>. Longest response delay: <strong>${longestResponse} hours</strong>.</p>
  <table><thead><tr><th>From</th><th>To</th><th>Relationship</th><th>Hours</th></tr></thead><tbody>
  ${responsePairs
    .map((pair) => `<tr><td>${escapeHtml(pair.source.title)}</td><td>${escapeHtml(pair.target.title)}</td><td>${escapeHtml(pair.type)}</td><td>${pair.hours}</td></tr>`)
    .join("") || "<tr><td colspan='4'>No response pairs recorded.</td></tr>"}
  </tbody></table>

  <h2>8. Appendices</h2>
  <p>Appendix A lists source paths and filenames for every evidence item.</p>
  <table><thead><tr><th>Evidence</th><th>Filename</th><th>Path</th></tr></thead><tbody>
  ${item.documents.map((document) => `<tr><td>${escapeHtml(document.title)}</td><td>${escapeHtml(document.filename)}</td><td>${escapeHtml(document.path)}</td></tr>`).join("")}
  </tbody></table>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  });
}
