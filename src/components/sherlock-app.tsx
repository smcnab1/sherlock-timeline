"use client";

import "@xyflow/react/dist/style.css";

import { uploadPresigned } from "@vercel/blob/client";
import { differenceInHours, format, formatDistanceStrict, parseISO } from "date-fns";
import {
  Background,
  Connection,
  Controls,
  Edge,
  MiniMap,
  Node,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  Activity,
  Archive,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Crosshair,
  DatabaseBackup,
  Download,
  Edit3,
  FilePlus2,
  Files,
  GitBranch,
  Link2,
  LogOut,
  Maximize2,
  PanelRight,
  Plus,
  Printer,
  Search,
  ShieldAlert,
  Trash2,
  Tags as TagsIcon,
  Upload,
  Users,
  X,
} from "lucide-react";
import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TimelineExperience } from "@/components/timeline/timeline-experience";
import { TagBadge } from "@/components/tags/tag-badge";
import { TagMultiSelect } from "@/components/tags/tag-multi-select";
import { TagsView } from "@/components/tags/tags-view";
import { cn } from "@/lib/utils";
import { evidenceApiErrorMessage, uploadNetworkErrorMessage } from "@/lib/evidence-errors";
import { createEvidenceStorageKey, EVIDENCE_FILE_ACCEPT, MAX_ZIP_EVIDENCE_FILE_BYTES, validateEvidenceFile } from "@/lib/evidence-policy";
import { useSherlockStore } from "@/lib/store";
import type {
  ActionItem,
  CaseSummary,
  CaseInsight,
  ConversationItem,
  DocumentItem,
  EventItem,
  Person,
  PersonRelationship,
  Relationship,
  Tag,
  WorkspaceCase,
  WorkspaceData,
} from "@/lib/types";

const sourceTypes = [
  "Email",
  "Teams Message",
  "Meeting Notes",
  "Policy",
  "Witness Statement",
  "Occupational Health",
  "HR Communication",
  "Letter",
  "Telephone Call",
  "Other",
];
const confidenceLevels = ["Confirmed", "Documented", "Witnessed", "Reported", "Alleged"];
const actionStatuses = ["Open", "In Progress", "Waiting", "Completed", "Cancelled"];
const eventTypes = [
  "Email",
  "Meeting",
  "Teams Message",
  "Phone Call",
  "Milestone",
  "Occupational Health",
  "HR Communication",
  "Grievance",
  "Sickness",
  "Policy",
  "Follow Up",
  "Decision",
  "Evidence",
  "Other",
];
const eventCategories = [
  "Communication",
  "Management",
  "HR",
  "Occupational Health",
  "Attendance",
  "Wellbeing",
  "Escalation",
  "Investigation",
  "Other",
];
const eventStatuses = ["open", "documented", "imported", "awaiting response", "active", "closed", "archived"];
const eventRelationshipTypes = ["linked-to", "followed-by", "follows", "responded-to", "requested-response", "context-for", "caused", "supports", "contradicts"];
const eventPersonRoles = ["From", "To", "CC", "BCC", "Sender", "Recipient", "Manager", "Direct Report", "HR", "Occupational Health", "Witness", "Decision Maker", "Involved"];
const personRelationshipTypes = [
  "Manager",
  "Direct Report",
  "Reports To",
  "Line Manager",
  "Senior Manager",
  "HR",
  "Occupational Health",
  "Witness",
  "Witnessed By",
  "Mentor",
  "Mentee",
  "Colleague",
  "Union Representative",
  "Investigator",
  "Other",
];
const defaultLeftSidebarWidth = 260;
const defaultRightSidebarWidth = 340;

type View = "dashboard" | "timeline" | "evidence" | "tags" | "import" | "people" | "actions" | "analytics" | "board" | "data";
type LoadedWorkspaceData = WorkspaceData & { activeCase: WorkspaceCase };
type EditingItem =
  | { type: "event"; item: EventItem }
  | { type: "person"; item: Person }
  | { type: "evidence"; item: DocumentItem }
  | { type: "action"; item: ActionItem }
  | { type: "case"; item: WorkspaceCase };

type ImportPreviewState = {
  jobId: string;
  summary: {
    files: number;
    messages: number;
    conversations: number;
    people: number;
    evidence: number;
    events: number;
    relationships: number;
    duplicates: number;
  };
  conversations: Array<{
    localId: string;
    title: string;
    messageCount: number;
    participants: string[];
    startedAt: string;
    endedAt: string;
    analytics: {
      averageResponseHours: number;
      longestResponseHours: number;
      followUpsRequired: number;
      escalations: number;
      periodsOfSilence: number;
    };
  }>;
  people: Array<{ name: string; email: string; existingPersonId?: string }>;
  events: Array<{
    localId: string;
    title: string;
    date: string;
    eventType: string;
    category: string;
    priority: string;
    confidence: number;
    duplicate: boolean;
  }>;
  relationships: Array<{ source: string; target: string; relationshipType: string }>;
  insights: string[];
};

function dateOf(value: string | Date) {
  return typeof value === "string" ? parseISO(value) : value;
}

function dayDiff(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function eventLane(event: EventItem) {
  const type = event.eventType.toLowerCase();
  if (type.includes("milestone") || type.includes("decision")) return "milestone";
  if (type.includes("meeting")) return "meeting";
  if (type.includes("email") || type.includes("message") || type.includes("communication") || type.includes("phone")) return "email";
  if (event.eventType === "action") return "action";
  if (type.includes("note")) return "note";
  return "other";
}

function importanceColour(importance: string) {
  const map: Record<string, string> = {
    critical: "bg-red-500/20 text-red-100 ring-red-400/40",
    high: "bg-amber-500/20 text-amber-100 ring-amber-400/40",
    medium: "bg-sky-500/20 text-sky-100 ring-sky-400/40",
    low: "bg-slate-500/20 text-slate-100 ring-slate-400/40",
  };
  return map[importance] ?? map.medium;
}

function statusColour(status: string) {
  const map: Record<string, string> = {
    Open: "bg-sky-500/20 text-sky-100",
    "In Progress": "bg-amber-500/20 text-amber-100",
    Waiting: "bg-violet-500/20 text-violet-100",
    Completed: "bg-emerald-500/20 text-emerald-100",
    Cancelled: "bg-slate-500/20 text-slate-200",
  };
  return map[status] ?? "bg-slate-700 text-slate-200";
}

function inverseRelationshipLabel(type: string) {
  const map: Record<string, string> = {
    Manager: "Direct Report",
    "Direct Report": "Manager",
    "Reports To": "Manager",
    Witness: "Witnessed By",
    "Witnessed By": "Witness",
    Mentor: "Mentee",
    Mentee: "Mentor",
    "Line Manager": "Direct Report",
    "Senior Manager": "Direct Report",
  };
  return map[type] ?? type;
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

function matchesQuery(event: EventItem, query: string) {
  if (!query.trim()) return true;
  const haystack = [
    event.title,
    event.description,
    event.notes,
    event.category,
    event.status,
    event.people.map((item) => item.person.name).join(" "),
    event.documents.map((item) => item.document.title || item.document.filename).join(" "),
    event.tags.map((item) => item.tag.name).join(" "),
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function evidenceMatches(evidence: DocumentItem, query: string, source: string, confidence: string) {
  const haystack = [
    evidence.title,
    evidence.filename,
    evidence.description,
    evidence.originalContent,
    JSON.stringify(evidence.extractedMetadata ?? ""),
    evidence.sourceType,
    evidence.sourceReference,
    evidence.confidenceLevel,
    evidence.people?.map((item) => item.person.name).join(" "),
    evidence.tags.map((item) => item.tag.name).join(" "),
  ].join(" ").toLowerCase();
  return (
    (!query.trim() || haystack.includes(query.toLowerCase())) &&
    (source === "all" || evidence.sourceType === source) &&
    (confidence === "all" || evidence.confidenceLevel === confidence)
  );
}

function readEventPeople(form: FormData) {
  const personIds = form.getAll("eventPersonId").map((value) => String(value));
  const roles = form.getAll("eventPersonRole").map((value) => String(value));
  const seen = new Set<string>();
  const people: Array<{ personId: string; role: string }> = [];

  personIds.forEach((personId, index) => {
    const cleanPersonId = personId.trim();
    const role = roles[index]?.trim() || "Involved";
    if (!cleanPersonId || seen.has(cleanPersonId)) return;
    seen.add(cleanPersonId);
    people.push({ personId: cleanPersonId, role });
  });

  return people;
}

function readLinkedEventIds(form: FormData) {
  return [...new Set([...form.getAll("eventIds"), form.get("eventId")].map((value) => String(value || "").trim()).filter(Boolean))];
}

function appendEventIds(form: FormData, eventIds: string[]) {
  form.delete("eventId");
  form.delete("eventIds");
  eventIds.forEach((eventId) => form.append("eventIds", eventId));
}

function readTagIds(form: FormData) {
  return [...new Set(form.getAll("tagIds").map((value) => String(value).trim()).filter(Boolean))];
}

function sortTags(tags: Tag[]) {
  return [...tags].sort((left, right) => left.name.localeCompare(right.name, "en-GB", { sensitivity: "base", numeric: true }));
}

async function tagMutationError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  return typeof payload?.error === "string"
    ? payload.error
    : payload?.error?.message || "The tag change could not be saved.";
}

function calculateAnalytics(events: EventItem[], relationships: Relationship[]) {
  const sorted = [...events].sort((a, b) => dateOf(a.startDate).getTime() - dateOf(b.startDate).getTime());
  const gaps = sorted.slice(1).map((event, index) => ({
    from: sorted[index],
    to: event,
    hours: differenceInHours(dateOf(event.startDate), dateOf(sorted[index].startDate)),
  }));
  const longestGap = [...gaps].sort((a, b) => b.hours - a.hours)[0];
  const responsePairs = relationships
    .map((relationship) => {
      const source = events.find((event) => event.id === relationship.sourceId);
      const target = events.find((event) => event.id === relationship.targetId);
      if (!source || !target) return null;
      const label = relationship.relationshipType.toLowerCase();
      const isResponse = label.includes("respond") || label.includes("acknowledge") || label.includes("requested");
      return {
        relationship,
        source,
        target,
        hours: differenceInHours(dateOf(target.startDate), dateOf(source.startDate)),
        isResponse,
      };
    })
    .filter((value): value is Exclude<typeof value, null> => value !== null && value.hours >= 0);
  const responseTimes = responsePairs.filter((pair) => pair.isResponse).map((pair) => pair.hours);
  const averageResponse = responseTimes.length
    ? Math.round(responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length)
    : 0;
  const longestResponse = responseTimes.length ? Math.max(...responseTimes) : 0;
  const categoryCounts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.category] = (acc[event.category] ?? 0) + 1;
    return acc;
  }, {});
  const peopleCounts = events.reduce<Record<string, number>>((acc, event) => {
    event.people.forEach((item) => {
      acc[item.person.name] = (acc[item.person.name] ?? 0) + 1;
    });
    return acc;
  }, {});
  const unanswered = sorted.filter(
    (event) =>
      /sent|request|follow.?up|referral/i.test(`${event.title} ${event.category}`) &&
      !responsePairs.some((pair) => pair.source.id === event.id && pair.isResponse),
  );
  return { longestGap, averageResponse, longestResponse, categoryCounts, peopleCounts, unanswered, responsePairs };
}

function buildNodes(
  events: EventItem[],
  people: Person[],
  evidence: DocumentItem[],
  actions: ActionItem[] = [],
  options = { events: true, people: true, evidence: true, actions: true },
) {
  const nodes: Node[] = [];
  const eventNodes: Node[] = events.slice(0, 80).map((event, index) => ({
    id: event.id,
    position: { x: 80 + (index % 5) * 230, y: 80 + Math.floor(index / 5) * 170 },
    data: {
      label: (
        <div className="min-w-44 max-w-52">
          <div className="text-[11px] font-bold uppercase text-sky-300">{event.eventType}</div>
          <div className="mt-1 text-sm font-semibold leading-snug text-slate-50">{event.title}</div>
          <div className="mt-2 font-mono text-xs text-sky-200">{format(dateOf(event.startDate), "dd MMM yyyy")}</div>
        </div>
      ),
    },
    style: {
      color: "#e5eefc",
      background: event.eventType === "milestone" ? "#2b1320" : "#07111f",
      border: `1px solid ${event.eventType === "milestone" ? "#fb7185" : "#0ea5e9"}`,
      boxShadow: "0 18px 36px rgba(0, 0, 0, 0.32)",
    },
    className: "rounded-md px-4 py-3 text-left transition-shadow",
  }));
  const peopleNodes: Node[] = people.slice(0, 12).map((person, index) => ({
    id: `person-${person.id}`,
    position: { x: 80 + (index % 6) * 190, y: 480 + Math.floor(index / 6) * 140 },
    data: { label: <NodeLabel eyebrow="Person" title={person.name} detail={person.role} /> },
    style: { color: "#dcfce7", background: "#052e22", border: "1px solid #10b981" },
    className: "rounded-md px-4 py-3 text-left",
  }));
  const evidenceNodes: Node[] = evidence.slice(0, 12).map((item, index) => ({
    id: `doc-${item.id}`,
    position: { x: 80 + (index % 6) * 210, y: 760 + Math.floor(index / 6) * 140 },
    data: { label: <NodeLabel eyebrow="Evidence" title={item.title || item.filename} detail={item.confidenceLevel} /> },
    style: { color: "#ede9fe", background: "#271746", border: "1px solid #8b5cf6" },
    className: "rounded-md px-4 py-3 text-left",
  }));
  const actionNodes: Node[] = actions.slice(0, 24).map((action, index) => ({
    id: `action-${action.id}`,
    position: { x: 80 + (index % 6) * 210, y: 1040 + Math.floor(index / 6) * 140 },
    data: { label: <NodeLabel eyebrow="Action" title={action.title} detail={action.status} /> },
    style: { color: "#fef9c3", background: "#33280b", border: "1px solid #facc15" },
    className: "rounded-md px-4 py-3 text-left",
  }));
  if (options.events) nodes.push(...eventNodes);
  if (options.people) nodes.push(...peopleNodes);
  if (options.evidence) nodes.push(...evidenceNodes);
  if (options.actions) nodes.push(...actionNodes);
  return nodes;
}

function buildEdges(events: EventItem[], relationships: Relationship[], actions: ActionItem[] = []) {
  const relationshipEdges: Edge[] = relationships.map((relationship) => ({
    id: relationship.id,
    source: relationship.sourceId,
    target: relationship.targetId,
    label: relationship.relationshipType,
    animated: relationship.relationshipType.includes("follow"),
    style: { stroke: "#38bdf8", strokeWidth: 2.25 },
    labelStyle: { fill: "#dbeafe", fontSize: 11, fontWeight: 700 },
    labelBgStyle: { fill: "#0f172a", fillOpacity: 0.96, stroke: "#334155", strokeWidth: 1 },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 4,
  }));
  const peopleEdges: Edge[] = events.flatMap((event) =>
    event.people.map((item) => ({
      id: `${event.id}-${item.person.id}`,
      source: event.id,
      target: `person-${item.person.id}`,
      label: item.role,
      style: { stroke: "#34d399", strokeDasharray: "4 7", strokeOpacity: 0.4, strokeWidth: 1.25 },
      labelStyle: { fill: "#bbf7d0", fontSize: 10 },
    })),
  );
  const evidenceEdges: Edge[] = events.flatMap((event) =>
    event.documents.map((item) => ({
      id: `${event.id}-${item.document.id}`,
      source: event.id,
      target: `doc-${item.document.id}`,
      style: { stroke: "#a78bfa", strokeDasharray: "6 8", strokeOpacity: 0.35, strokeWidth: 1.2 },
    })),
  );
  const actionEdges: Edge[] = actions.flatMap((action) => {
    const nextEdges: Edge[] = [];
    if (action.eventId) {
      nextEdges.push({
            id: `action-${action.id}-${action.eventId}`,
            source: `action-${action.id}`,
            target: action.eventId,
            label: "relates to",
            style: { stroke: "#facc15", strokeOpacity: 0.42, strokeWidth: 1.3 },
            labelStyle: { fill: "#fef08a", fontSize: 10 },
      });
    }
    if (action.ownerId) {
      nextEdges.push({
            id: `action-${action.id}-${action.ownerId}`,
            source: `action-${action.id}`,
            target: `person-${action.ownerId}`,
            label: "owner",
            style: { stroke: "#facc15", strokeDasharray: "4 6", strokeOpacity: 0.35, strokeWidth: 1.2 },
            labelStyle: { fill: "#fef08a", fontSize: 10 },
      });
    }
    return nextEdges;
  });
  return [...relationshipEdges, ...peopleEdges, ...evidenceEdges, ...actionEdges];
}

export function SherlockApp({ initialData, initialNow }: { initialData: LoadedWorkspaceData; initialNow: string }) {
  const { activeCase, selectedEventId, query, scale, setCase, setSelectedEventId, setQuery, setScale, addEvent, deleteEvent } =
    useSherlockStore();
  const [cases, setCases] = useState<CaseSummary[]>(initialData.cases);
  const [relationships, setRelationships] = useState(initialData.relationships);
  const [people, setPeople] = useState(initialData.people);
  const [personRelationships, setPersonRelationships] = useState(initialData.personRelationships);
  const [evidence, setEvidence] = useState(initialData.evidence);
  const [tags, setTags] = useState(initialData.tags);
  const [actions, setActions] = useState(initialData.actions);
  const [auditTrail, setAuditTrail] = useState(initialData.auditTrail);
  const [backups, setBackups] = useState(initialData.backups);
  const [conversations, setConversations] = useState(initialData.conversations);
  const [importJobs, setImportJobs] = useState(initialData.importJobs);
  const [caseInsights, setCaseInsights] = useState(initialData.insights);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [showCaseManager, setShowCaseManager] = useState(false);
  const [showNewCase, setShowNewCase] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ type: "event"; item: EventItem } | { type: "case"; item: WorkspaceCase } | null>(null);
  const [editing, setEditing] = useState<EditingItem | null>(null);
  const [editingPersonRelationship, setEditingPersonRelationship] = useState<PersonRelationship | null>(null);
  const [evidenceSource, setEvidenceSource] = useState("all");
  const [evidenceConfidence, setEvidenceConfidence] = useState("all");
  const [selectedPersonId, setSelectedPersonId] = useState(initialData.people[0]?.id ?? "");
  const [savedTimelineFilter, setSavedTimelineFilter] = useState("");
  const [boardQuery, setBoardQuery] = useState("");
  const [boardFilters, setBoardFilters] = useState({ events: true, people: true, evidence: true, actions: true });
  const [selectedBoardNodeId, setSelectedBoardNodeId] = useState<string | null>(null);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(defaultLeftSidebarWidth);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(defaultRightSidebarWidth);
  const [showEventModal, setShowEventModal] = useState(false);
  const [evidenceUploadProgress, setEvidenceUploadProgress] = useState<number | null>(null);
  const evidenceUploadInProgress = useRef(false);
  const renderNow = useMemo(() => parseISO(initialNow), [initialNow]);

  useEffect(() => {
    setCase(initialData.activeCase);
  }, [initialData.activeCase, setCase]);

  function applyWorkspace(data: WorkspaceData) {
    if (data.activeCase) {
      setCase(data.activeCase);
    }
    setCases(data.cases);
    setRelationships(data.relationships);
    setPeople(data.people);
    setPersonRelationships(data.personRelationships);
    setEvidence(data.evidence);
    setTags(data.tags);
    setActions(data.actions);
    setAuditTrail(data.auditTrail);
    setBackups(data.backups);
    setConversations(data.conversations);
    setImportJobs(data.importJobs);
    setCaseInsights(data.insights);
    if (!data.people.some((person) => person.id === selectedPersonId)) {
      setSelectedPersonId(data.people[0]?.id ?? "");
    }
  }

  async function refreshWorkspace(caseId = caseData.id) {
    const response = await fetch(`/api/cases?caseId=${encodeURIComponent(caseId)}`);
    if (!response.ok) {
      throw new Error("Failed to refresh workspace");
    }
    const data = (await response.json()) as WorkspaceData;
    applyWorkspace(data);
    return data;
  }

  async function refreshWorkspaceAfterMutation(caseId = caseData.id) {
    try {
      return await refreshWorkspace(caseId);
    } catch {
      toast.warning("Saved, but live refresh failed. Refresh the page if the latest data is not visible.");
      return null;
    }
  }

  async function uploadEvidenceFile(file: File, form: FormData, eventIds: string[]) {
    if (evidenceUploadInProgress.current) throw new Error("An evidence upload is already in progress.");
    evidenceUploadInProgress.current = true;
    setEvidenceUploadProgress(0);
    try {
      const validation = validateEvidenceFile(file);
      form.set("caseId", caseData.id);
      appendEventIds(form, eventIds);
      if (validation.maximumSizeBytes !== MAX_ZIP_EVIDENCE_FILE_BYTES) return await fetch("/api/upload", { method: "POST", body: form });
      const documentId = crypto.randomUUID();
      const objectId = crypto.randomUUID();
      const upload = { caseId: caseData.id, eventIds, tagIds: readTagIds(form), personId: String(form.get("personId") || ""), title: String(form.get("title") || ""), description: String(form.get("description") || ""), sourceType: String(form.get("sourceType") || ""), sourceReference: String(form.get("sourceReference") || ""), confidenceLevel: String(form.get("confidenceLevel") || ""), documentId, objectId, filename: validation.originalFilename, contentType: validation.contentType, size: file.size };
      const blob = await uploadPresigned(createEvidenceStorageKey(caseData.id, documentId, validation.safeFilename, objectId), file, {
        access: "private",
        contentType: validation.contentType,
        handleUploadUrl: "/api/upload/direct",
        clientPayload: JSON.stringify(upload),
        multipart: true,
        onUploadProgress: ({ percentage }) => setEvidenceUploadProgress(percentage),
      });
      setEvidenceUploadProgress(100);
      return await fetch("/api/upload/finalise", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload, blobUrl: blob.url }) });
    } finally {
      evidenceUploadInProgress.current = false;
      setEvidenceUploadProgress(null);
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const editableTarget = isEditableElement(event.target);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("global-search")?.focus();
      }
      if (!editableTarget && !showNewEvent && !editing && event.key.toLowerCase() === "n") setShowNewEvent(true);
      if (event.key === "Escape") {
        setShowNewEvent(false);
        setShowEventModal(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editing, showNewEvent]);

  const caseData = activeCase ?? initialData.activeCase;
  const caseWithActions = { ...caseData, actions };
  const filteredEvents = useMemo(() => {
    const base = caseData.events.filter((event) => matchesQuery(event, query));
    if (!savedTimelineFilter) return base;
    return base.filter((event) => eventLane(event) === savedTimelineFilter || event.category === savedTimelineFilter);
  }, [caseData.events, query, savedTimelineFilter]);
  const selectedEvent = filteredEvents.find((event) => event.id === selectedEventId) ?? filteredEvents[0];
  const visibleEvidence = useMemo(
    () => evidence.filter((item) => evidenceMatches(item, query, evidenceSource, evidenceConfidence)),
    [evidence, evidenceConfidence, evidenceSource, query],
  );
  const analytics = useMemo(() => calculateAnalytics(caseData.events, relationships), [caseData.events, relationships]);
  const insights = useMemo(() => {
    const seeded = caseInsights;
    const overdue = actions
      .filter((action) => !["Completed", "Cancelled"].includes(action.status) && dateOf(action.dueDate) < renderNow)
      .map<CaseInsight>((action) => ({
        id: `client-overdue-${action.id}`,
        severity: dayDiff(dateOf(action.dueDate), renderNow) > 30 ? "critical" : "warning",
        title: "Overdue action",
        detail: `"${action.title}" was due ${format(dateOf(action.dueDate), "dd MMM yyyy")}.`,
      }));
    return [...overdue, ...seeded].slice(0, 8);
  }, [actions, caseInsights, renderNow]);
  const boardEvents = useMemo(
    () => filteredEvents.filter((event) => !boardQuery || `${event.title} ${event.eventType} ${event.category}`.toLowerCase().includes(boardQuery.toLowerCase())),
    [boardQuery, filteredEvents],
  );
  const boardPeople = useMemo(
    () => people.filter((person) => !boardQuery || `${person.name} ${person.role} ${person.organisation}`.toLowerCase().includes(boardQuery.toLowerCase())),
    [boardQuery, people],
  );
  const boardEvidence = useMemo(
    () => evidence.filter((item) => !boardQuery || `${item.title} ${item.filename} ${item.description} ${item.originalContent ?? ""} ${item.sourceType} ${item.tags.map((link) => link.tag.name).join(" ")}`.toLowerCase().includes(boardQuery.toLowerCase())),
    [boardQuery, evidence],
  );
  const boardActions = useMemo(
    () => actions.filter((action) => !boardQuery || `${action.title} ${action.status} ${action.description}`.toLowerCase().includes(boardQuery.toLowerCase())),
    [actions, boardQuery],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(boardEvents, boardPeople, boardEvidence, boardActions, boardFilters));
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(filteredEvents, relationships, actions));

  function beginSidebarResize(side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftSidebarWidth : rightSidebarWidth;

    function move(pointerEvent: PointerEvent) {
      const delta = pointerEvent.clientX - startX;
      const nextWidth = side === "left" ? startWidth + delta : startWidth - delta;
      const setWidth = side === "left" ? setLeftSidebarWidth : setRightSidebarWidth;
      setWidth(clamp(nextWidth, side === "right" ? 320 : 220, 620));
    }

    function stop() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  useEffect(() => {
    const visibleNodeIds = new Set(buildNodes(boardEvents, boardPeople, boardEvidence, boardActions, boardFilters).map((node) => node.id));
    setNodes(
      buildNodes(boardEvents, boardPeople, boardEvidence, boardActions, boardFilters).map((node) => ({
        ...node,
        style: {
          ...node.style,
          opacity: selectedBoardNodeId && node.id !== selectedBoardNodeId ? 0.72 : 1,
          boxShadow: node.id === selectedBoardNodeId ? "0 0 0 3px rgba(56,189,248,.65), 0 18px 38px rgba(0,0,0,.38)" : node.style?.boxShadow,
        },
      })),
    );
    setEdges(buildEdges(filteredEvents, relationships, actions).filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)));
  }, [actions, boardActions, boardEvidence, boardEvents, boardFilters, boardPeople, filteredEvents, relationships, selectedBoardNodeId, setEdges, setNodes]);

  async function createRelationship(connection: Connection) {
    if (!connection.source || !connection.target || connection.target.startsWith("person-") || connection.target.startsWith("doc-")) {
      setEdges((current) => addEdge(connection, current));
      return;
    }
    try {
      const response = await fetch("/api/relationships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: connection.source, targetId: connection.target, relationshipType: "linked-to" }),
      });
      if (!response.ok) throw new Error("Relationship failed");
      const created = (await response.json()) as Relationship[];
      setRelationships((current) => [...current.filter((item) => !created.some((next) => next.id === item.id)), ...created]);
      toast.success("Relationship added");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to add relationship");
    }
  }

  async function createTag(name: string, colour: string) {
    const response = await fetch("/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: caseData.id, name, colour }),
    });
    if (!response.ok) throw new Error(await tagMutationError(response));
    const created = { ...(await response.json()) as Tag, assignmentCount: 0 };
    setTags((current) => sortTags([...current.filter((tag) => tag.id !== created.id), created]));
    toast.success(`Tag “${created.name}” created`);
    return created;
  }

  async function updateTag(tag: Tag, name: string, colour: string) {
    const response = await fetch(`/api/tags/${encodeURIComponent(tag.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: caseData.id, name, colour }),
    });
    if (!response.ok) throw new Error(await tagMutationError(response));
    const responseTag = (await response.json()) as Tag;
    const updated = { ...responseTag, assignmentCount: responseTag.assignmentCount ?? tag.assignmentCount };
    setTags((current) => sortTags(current.map((item) => item.id === updated.id ? updated : item)));
    setCase({
      ...caseData,
      events: caseData.events.map((item) => ({
        ...item,
        tags: item.tags.map((link) => link.tag.id === updated.id ? { tag: updated } : link),
      })),
    });
    setEvidence((current) => current.map((item) => ({
      ...item,
      tags: item.tags.map((link) => link.tag.id === updated.id ? { tag: updated } : link),
    })));
    toast.success("Tag updated");
    return updated;
  }

  async function deleteTag(tag: Tag) {
    const response = await fetch(`/api/tags/${encodeURIComponent(tag.id)}?caseId=${encodeURIComponent(caseData.id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await tagMutationError(response));
    setTags((current) => current.filter((item) => item.id !== tag.id));
    toast.success("Tag deleted");
    await refreshWorkspaceAfterMutation();
  }

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const createAnother = form.get("createAnother") === "on";
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseId: caseData.id,
          title: form.get("title"),
          description: form.get("description"),
          notes: form.get("notes"),
          eventType: form.get("eventType"),
          category: form.get("category"),
          importance: form.get("importance"),
          status: form.get("status") || "open",
          startDate: form.get("startDate"),
          people: readEventPeople(form),
          tagIds: readTagIds(form),
        }),
      });
      if (!response.ok) throw new Error("Create event failed");
      const created = (await response.json()) as EventItem;
      addEvent(created);
      toast.success("Event created");
      if (createAnother) target.reset();
      else setShowNewEvent(false);
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to save event");
    }
  }

  async function createEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const eventIds = readLinkedEventIds(form);
    const file = form.get("file");
    try {
      const response = file instanceof File && file.size > 0
        ? await uploadEvidenceFile(file, form, eventIds)
        : await fetch("/api/evidence", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              caseId: caseData.id,
              title: form.get("title"),
              filename: form.get("sourceReference") || form.get("title"),
              description: form.get("description"),
              sourceType: form.get("sourceType"),
              sourceReference: form.get("sourceReference"),
              confidenceLevel: form.get("confidenceLevel"),
              eventIds,
              personId: form.get("personId"),
              tagIds: readTagIds(form),
            }),
          });
      if (!response.ok) throw new Error(await evidenceApiErrorMessage(response, "The evidence could not be saved."));
      const created = (await response.json()) as DocumentItem;
      setEvidence((current) => [created, ...current]);
      toast.success("Evidence uploaded");
      if (form.get("createAnother") === "on") target.reset();
      else target.reset();
      await refreshWorkspaceAfterMutation();
    } catch (error) {
      toast.error(uploadNetworkErrorMessage(error));
    }
  }

  async function uploadEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const eventIds = readLinkedEventIds(form);
    try {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new Error("Select a file to upload.");
      const response = await uploadEvidenceFile(file, form, eventIds.length ? eventIds : selectedEvent ? [selectedEvent.id] : []);
      if (!response.ok) throw new Error(await evidenceApiErrorMessage(response, "The evidence upload failed."));
      const created = (await response.json()) as DocumentItem;
      setEvidence((current) => [created, ...current]);
      toast.success("Evidence uploaded");
      target.reset();
      await refreshWorkspaceAfterMutation();
    } catch (error) {
      toast.error(uploadNetworkErrorMessage(error));
    }
  }

  async function createAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseId: caseData.id,
          title: form.get("title"),
          description: form.get("description"),
          ownerId: form.get("ownerId"),
          dueDate: form.get("dueDate"),
          status: form.get("status"),
          eventId: form.get("eventId"),
          documentId: form.get("documentId"),
        }),
      });
      if (!response.ok) throw new Error("Create action failed");
      const created = (await response.json()) as ActionItem;
      setActions((current) => [...current, created].sort((a, b) => dateOf(a.dueDate).getTime() - dateOf(b.dueDate).getTime()));
      toast.success("Action created");
      target.reset();
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to save action");
    }
  }

  async function updateActionStatus(action: ActionItem, status: string) {
    const previous = actions;
    setActions((current) => current.map((item) => (item.id === action.id ? { ...item, status } : item)));
    try {
      const response = await fetch("/api/actions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: action.id, status }),
      });
      if (!response.ok) throw new Error("Update action failed");
      const updated = (await response.json()) as ActionItem;
      setActions((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Action updated");
      await refreshWorkspaceAfterMutation();
    } catch {
      setActions(previous);
      toast.error("Failed to save action");
    }
  }

  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseId: caseData.id,
          name: form.get("name"),
          role: form.get("role"),
          organisation: form.get("organisation"),
          notes: form.get("notes"),
        }),
      });
      if (!response.ok) throw new Error("Create person failed");
      const created = (await response.json()) as Person;
      setPeople((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedPersonId(created.id);
      toast.success("Person created");
      target.reset();
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to save person");
    }
  }

  async function createPersonRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/person-relationships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseId: caseData.id,
          sourceId: form.get("sourceId"),
          targetId: form.get("targetId"),
          relationshipType: form.get("relationshipType"),
          notes: form.get("notes"),
        }),
      });
      if (!response.ok) throw new Error("Relationship failed");
      const created = (await response.json()) as PersonRelationship[];
      setPersonRelationships((current) => [...current.filter((item) => !created.some((next) => next.id === item.id)), ...created]);
      toast.success("Relationship added");
      await refreshWorkspaceAfterMutation();
      event.currentTarget.reset();
    } catch {
      toast.error("Failed to add relationship");
    }
  }

  async function updatePersonRelationship(event: FormEvent<HTMLFormElement>, relationship: PersonRelationship) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/person-relationships", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: relationship.id,
          caseId: caseData.id,
          sourceId: form.get("sourceId"),
          targetId: form.get("targetId"),
          relationshipType: form.get("relationshipType"),
          notes: form.get("notes"),
        }),
      });
      if (!response.ok) throw new Error("Relationship update failed");
      const updated = (await response.json()) as PersonRelationship[];
      setPersonRelationships((current) => [...current.filter((item) => !updated.some((next) => next.id === item.id)), ...updated]);
      setEditingPersonRelationship(null);
      toast.success("Relationship updated");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to update relationship");
    }
  }

  async function deletePersonRelationship(relationship: PersonRelationship) {
    try {
      const response = await fetch(`/api/person-relationships?id=${encodeURIComponent(relationship.id)}&caseId=${encodeURIComponent(caseData.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Relationship delete failed");
      setPersonRelationships((current) =>
        current.filter(
          (item) =>
            item.id !== relationship.id &&
            !(item.sourceId === relationship.targetId && item.targetId === relationship.sourceId),
        ),
      );
      toast.success("Relationship deleted");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to delete relationship");
    }
  }

  async function updateEventRelationship(relationship: Relationship, relationshipType: string) {
    const previous = relationships;
    setRelationships((current) => current.map((item) => (item.id === relationship.id ? { ...item, relationshipType } : item)));
    try {
      const response = await fetch("/api/relationships", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: relationship.id, relationshipType }),
      });
      if (!response.ok) throw new Error("Event relationship update failed");
      const updated = (await response.json()) as Relationship;
      setRelationships((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Relationship updated");
      await refreshWorkspaceAfterMutation();
    } catch {
      setRelationships(previous);
      toast.error("Failed to update relationship");
    }
  }

  async function deleteEventRelationship(relationship: Relationship) {
    const previous = relationships;
    setRelationships((current) => current.filter((item) => item.id !== relationship.id));
    try {
      const response = await fetch(`/api/relationships?id=${encodeURIComponent(relationship.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Event relationship delete failed");
      toast.success("Relationship deleted");
      await refreshWorkspaceAfterMutation();
    } catch {
      setRelationships(previous);
      toast.error("Failed to delete relationship");
    }
  }

  async function removeEvent(eventId: string) {
    const event = caseData.events.find((item) => item.id === eventId);
    if (!event) return;
    try {
      const response = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Archive event failed");
      setRelationships((current) => current.filter((relationship) => relationship.sourceId !== eventId && relationship.targetId !== eventId));
      deleteEvent(eventId);
      toast.success("Event deleted");
      setArchiveTarget(null);
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to delete event");
    }
  }

  async function createBackup() {
    const response = await fetch(`/api/cases/${caseData.id}/backup`, { method: "POST" });
    if (!response.ok) toast.error("Backup failed");
    else {
      toast.success("Backup created");
      await refreshWorkspaceAfterMutation();
    }
  }

  async function switchInvestigation(caseId: string) {
    try {
      const data = await refreshWorkspace(caseId);
      setSelectedEventId(data.activeCase?.events[0]?.id ?? null);
      toast.success("Investigation switched");
      setShowCaseManager(false);
    } catch {
      toast.error("Failed to switch investigation");
    }
  }

  async function createInvestigation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          status: form.get("status"),
        }),
      });
      if (!response.ok) throw new Error("Create investigation failed");
      const created = (await response.json()) as WorkspaceCase;
      toast.success("Investigation created");
      setShowNewCase(false);
      target.reset();
      await refreshWorkspaceAfterMutation(created.id);
    } catch {
      toast.error("Failed to save investigation");
    }
  }

  async function updateInvestigation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      const response = await fetch("/api/cases", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: caseData.id,
          title: form.get("title"),
          description: form.get("description"),
          status: form.get("status"),
        }),
      });
      if (!response.ok) throw new Error("Update investigation failed");
      setEditing(null);
      toast.success("Investigation updated");
      await refreshWorkspaceAfterMutation(caseData.id);
    } catch {
      toast.error("Failed to save investigation");
    }
  }

  async function archiveInvestigation(item: WorkspaceCase) {
    try {
      const response = await fetch("/api/cases", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, archived: true, status: "archived" }),
      });
      if (!response.ok) throw new Error("Archive investigation failed");
      const nextCaseId = cases.find((candidate) => candidate.id !== item.id && !candidate.deletedAt)?.id;
      setArchiveTarget(null);
      toast.success("Investigation archived");
      await refreshWorkspaceAfterMutation(nextCaseId ?? item.id);
    } catch {
      toast.error("Failed to archive investigation");
    }
  }

  async function deleteInvestigation(caseId: string) {
    try {
      const response = await fetch(`/api/cases?caseId=${encodeURIComponent(caseId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete investigation failed");
      const nextCaseId = cases.find((candidate) => candidate.id !== caseId && !candidate.deletedAt)?.id;
      toast.success("Investigation deleted");
      if (nextCaseId) await refreshWorkspaceAfterMutation(nextCaseId);
    } catch {
      toast.error("Failed to delete investigation");
    }
  }

  async function updateEvent(event: FormEvent<HTMLFormElement>, item: EventItem) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/events/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          notes: form.get("notes"),
          eventType: form.get("eventType"),
          category: form.get("category"),
          importance: form.get("importance"),
          status: form.get("status"),
          startDate: form.get("startDate"),
          people: readEventPeople(form),
          tagIds: readTagIds(form),
        }),
      });
      if (!response.ok) throw new Error("Update event failed");
      const updated = (await response.json()) as EventItem;
      setCase({
        ...caseData,
        events: caseData.events.map((event) => (event.id === updated.id ? updated : event)),
      });
      setEditing(null);
      toast.success("Event updated");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to save event");
    }
  }

  async function updatePerson(event: FormEvent<HTMLFormElement>, item: Person) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/people", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          caseId: caseData.id,
          name: form.get("name"),
          role: form.get("role"),
          organisation: form.get("organisation"),
          notes: form.get("notes"),
        }),
      });
      if (!response.ok) throw new Error("Update person failed");
      const updated = (await response.json()) as Person;
      setPeople((current) => current.map((person) => (person.id === updated.id ? updated : person)).sort((a, b) => a.name.localeCompare(b.name)));
      setEditing(null);
      toast.success("Person updated");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to save person");
    }
  }

  async function updateEvidence(event: FormEvent<HTMLFormElement>, item: DocumentItem) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/evidence", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          title: form.get("title"),
          description: form.get("description"),
          sourceType: form.get("sourceType"),
          sourceReference: form.get("sourceReference"),
          confidenceLevel: form.get("confidenceLevel"),
          eventIds: readLinkedEventIds(form),
          personId: form.get("personId"),
          tagIds: readTagIds(form),
        }),
      });
      if (!response.ok) throw new Error("Update evidence failed");
      const updated = (await response.json()) as DocumentItem;
      setEvidence((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditing(null);
      toast.success("Evidence updated");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to save evidence");
    }
  }

  async function updateAction(event: FormEvent<HTMLFormElement>, item: ActionItem) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/actions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          title: form.get("title"),
          description: form.get("description"),
          ownerId: form.get("ownerId"),
          dueDate: form.get("dueDate"),
          status: form.get("status"),
          eventId: form.get("eventId"),
          documentId: form.get("documentId"),
        }),
      });
      if (!response.ok) throw new Error("Update action failed");
      const updated = (await response.json()) as ActionItem;
      setActions((current) => current.map((action) => (action.id === updated.id ? updated : action)));
      setEditing(null);
      toast.success("Action updated");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to save action");
    }
  }

  async function groupEventsIntoConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseId: caseData.id,
          title: form.get("title"),
          conversationId: form.get("conversationId"),
          eventIds: readLinkedEventIds(form),
        }),
      });
      if (!response.ok) throw new Error("Conversation link failed");
      toast.success("Conversation updated");
      target.reset();
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to group conversation");
    }
  }

  async function archiveEvidence(item: DocumentItem) {
    try {
      const response = await fetch("/api/evidence", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, deleted: true }),
      });
      if (!response.ok) throw new Error("Archive evidence failed");
      setEvidence((current) => current.filter((candidate) => candidate.id !== item.id));
      toast.success("Evidence deleted");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to delete evidence");
    }
  }

  async function archivePerson(item: Person) {
    try {
      const response = await fetch("/api/people", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, caseId: caseData.id, deleted: true }),
      });
      if (!response.ok) throw new Error("Archive person failed");
      setPeople((current) => current.filter((candidate) => candidate.id !== item.id));
      toast.success("Person deleted");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to delete person");
    }
  }

  async function archiveAction(item: ActionItem) {
    try {
      const response = await fetch("/api/actions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, deleted: true }),
      });
      if (!response.ok) throw new Error("Archive action failed");
      setActions((current) => current.filter((candidate) => candidate.id !== item.id));
      toast.success("Action deleted");
      await refreshWorkspaceAfterMutation();
    } catch {
      toast.error("Failed to delete action");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="shrink-0 border-b border-slate-800 bg-slate-950/95">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <div className="flex min-w-64 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-sky-400 text-slate-950">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Sherlock</h1>
              <button type="button" onClick={() => setShowCaseManager(true)} className="mt-0.5 flex items-center gap-1 text-left text-xs text-slate-400 hover:text-sky-200">
                {caseData.title}
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <Input id="global-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case data" className="pl-9" />
          </div>
          <Button size="sm" onClick={() => setShowNewEvent(true)}>
            <Plus className="h-4 w-4" /> Event
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowCaseManager(true)}>
            <Files className="h-4 w-4" /> Investigations
          </Button>
          <a href={`/api/report/${caseData.id}`} target="_blank">
            <Button variant="secondary" size="icon" title="Open printable report">
              <Printer className="h-4 w-4" />
            </Button>
          </a>
          <Button variant="ghost" size="icon" title="Sign out" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-5 pb-3">
          {[
            ["dashboard", Activity, "Dashboard"],
            ["timeline", CalendarClock, "Timeline"],
            ["evidence", Files, "Evidence"],
            ["tags", TagsIcon, "Tags"],
            ["import", Upload, "Investigation Import"],
            ["people", Users, "People"],
            ["actions", CheckCircle2, "Actions"],
            ["analytics", BarChart3, "Analytics"],
            ["board", GitBranch, "Board"],
            ["data", DatabaseBackup, "Data"],
          ].map(([view, Icon, label]) => {
            const TypedIcon = Icon as typeof Activity;
            return (
              <Button key={String(view)} variant={activeView === view ? "default" : "ghost"} size="sm" onClick={() => setActiveView(view as View)}>
                <TypedIcon className="h-4 w-4" /> {label as string}
              </Button>
            );
          })}
        </nav>
      </header>

      <section
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `${leftSidebarWidth}px 8px minmax(0, 1fr) 8px ${rightSidebarWidth}px`,
        }}
      >
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-4 shrink-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">Case status</div>
            <div className="mt-1 text-sm font-semibold text-sky-200">{caseData.status}</div>
            <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-400">{caseData.description}</p>
          </div>
          <div className="mb-4 grid shrink-0 grid-cols-2 gap-2">
            <Metric label="Events" value={caseData.events.length} />
            <Metric label="Evidence" value={evidence.length} />
            <Metric label="People" value={people.length} />
            <Metric label="Actions" value={actions.length} />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {filteredEvents.map((event) => (
              <button
                key={event.id}
                onClick={() => setSelectedEventId(event.id)}
                className={cn(
                  "w-full rounded-md border p-3 text-left transition-colors",
                  selectedEvent?.id === event.id ? "border-sky-400 bg-sky-400/10" : "border-slate-800 bg-slate-950/80 hover:border-slate-600",
                )}
              >
                <div className="text-xs font-mono text-sky-200">{format(dateOf(event.startDate), "dd MMM yyyy")}</div>
                <div className="mt-1 text-sm font-medium">{event.title}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge className={cn("ring-1", importanceColour(event.importance))}>{event.importance}</Badge>
                  <Badge className="bg-slate-800 text-slate-300">{event.eventType}</Badge>
                  {event.tags.slice(0, 2).map((link) => <TagBadge key={link.tag.id} tag={link.tag} />)}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <ResizeHandle
          label="Resize case list"
          onPointerDown={(event) => beginSidebarResize("left", event)}
          onDoubleClick={() => setLeftSidebarWidth(defaultLeftSidebarWidth)}
        />

        <section className="min-h-0 min-w-0 overflow-hidden">
          {activeView === "dashboard" && (
            <Dashboard
              caseData={caseWithActions}
              evidence={evidence}
              actions={actions}
              insights={insights}
              conversations={conversations}
              now={renderNow}
              onOpenImport={() => setActiveView("import")}
            />
          )}
          {activeView === "timeline" && (
            <TimelineExperience
              events={filteredEvents}
              relationships={relationships}
              actions={actions}
              scale={scale}
              setScale={setScale}
              selectedId={selectedEvent?.id}
              onSelect={setSelectedEventId}
              savedFilter={savedTimelineFilter}
              setSavedFilter={setSavedTimelineFilter}
              query={query}
              setQuery={setQuery}
            />
          )}
          {activeView === "evidence" && (
            <EvidenceDashboard
              evidence={visibleEvidence}
              events={caseData.events}
              people={people}
              source={evidenceSource}
              setSource={setEvidenceSource}
              confidence={evidenceConfidence}
              setConfidence={setEvidenceConfidence}
              onCreate={createEvidence}
              onOpenImport={() => setActiveView("import")}
              onEdit={(item) => setEditing({ type: "evidence", item })}
              onDelete={archiveEvidence}
              tags={tags}
              onCreateTag={createTag}
              uploadProgress={evidenceUploadProgress}
            />
          )}
          {activeView === "tags" && (
            <TagsView
              tags={tags}
              events={caseData.events}
              evidence={evidence}
              onCreateTag={createTag}
              onUpdateTag={updateTag}
              onDeleteTag={deleteTag}
              onOpenEvent={(item) => {
                setSelectedEventId(item.id);
                setActiveView("timeline");
                setShowEventModal(true);
              }}
              onOpenEvidence={(item) => setEditing({ type: "evidence", item })}
            />
          )}
          {activeView === "import" && <InvestigationImport caseId={caseData.id} conversations={conversations} importJobs={importJobs} onImported={() => refreshWorkspace()} />}
          {activeView === "people" && (
            <PeoplePage
              people={people}
              events={caseData.events}
              evidence={evidence}
              relationships={personRelationships}
              selectedPersonId={selectedPersonId}
              setSelectedPersonId={setSelectedPersonId}
              onCreatePerson={createPerson}
              onCreateRelationship={createPersonRelationship}
              onEditRelationship={setEditingPersonRelationship}
              onDeleteRelationship={deletePersonRelationship}
              onEditPerson={(item) => setEditing({ type: "person", item })}
              onDeletePerson={archivePerson}
            />
          )}
          {activeView === "actions" && (
            <ActionDashboard actions={actions} events={caseData.events} evidence={evidence} people={people} now={renderNow} onCreate={createAction} onStatus={updateActionStatus} onEdit={(item) => setEditing({ type: "action", item })} onDelete={archiveAction} />
          )}
          {activeView === "analytics" && <AnalyticsPanel events={caseData.events} analytics={analytics} />}
          {activeView === "board" && (
            <div className="flex h-full min-h-0 flex-col bg-slate-950">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/70 px-4 py-3">
                <div className="relative min-w-56 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input value={boardQuery} onChange={(event) => setBoardQuery(event.target.value)} placeholder="Search board nodes" className="h-9 pl-9" />
                </div>
                {(["events", "people", "evidence", "actions"] as const).map((key) => (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={boardFilters[key] ? "default" : "secondary"}
                    onClick={() => setBoardFilters((current) => ({ ...current, [key]: !current[key] }))}
                  >
                    {key}
                  </Button>
                ))}
                <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedBoardNodeId(null)}>
                  <Crosshair className="h-4 w-4" /> Clear focus
                </Button>
              </div>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={createRelationship}
                onNodeClick={(_, node) => setSelectedBoardNodeId(node.id)}
                fitView
              >
                <Background color="#334155" gap={20} />
                <MiniMap pannable zoomable nodeColor="#0ea5e9" />
                <Controls />
              </ReactFlow>
            </div>
          )}
          {activeView === "data" && <DataSafety caseId={caseData.id} audit={auditTrail} backups={backups} onBackup={createBackup} />}
        </section>

        <ResizeHandle
          label="Resize event context"
          onPointerDown={(event) => beginSidebarResize("right", event)}
          onDoubleClick={() => setRightSidebarWidth(defaultRightSidebarWidth)}
        />

        <aside className="min-h-0 overflow-y-auto overflow-x-hidden border-l border-slate-800 bg-slate-900/80">
          <EventInspector
            event={selectedEvent}
            relationships={relationships}
            allEvents={caseData.events}
            onUpload={uploadEvidence}
            onDelete={(eventId) => {
              const item = caseData.events.find((candidate) => candidate.id === eventId);
              if (item) setArchiveTarget({ type: "event", item });
            }}
            onEdit={(item) => setEditing({ type: "event", item })}
            onUpdateRelationship={updateEventRelationship}
            onDeleteRelationship={deleteEventRelationship}
            conversations={conversations}
            onGroupConversation={groupEventsIntoConversation}
            onOpenFull={() => setShowEventModal(true)}
            tags={tags}
            onCreateTag={createTag}
            uploadProgress={evidenceUploadProgress}
          />
        </aside>
      </section>

      {showNewEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6">
          <form onSubmit={createEvent} className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add event</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewEvent(false)}>Close</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title"><Input name="title" placeholder="Title" required /></Field>
              <Field label="Date and time"><Input name="startDate" type="datetime-local" required /></Field>
              <Field label="Event type">
                <select name="eventType" defaultValue="Email" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">
                  {eventTypes.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Category">
                <select name="category" defaultValue="Communication" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">
                  {eventCategories.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Importance">
                <select name="importance" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">
                  <option>medium</option><option>high</option><option>critical</option><option>low</option>
                </select>
              </Field>
              <Field label="Status">
                <select name="status" defaultValue="open" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">
                  {eventStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </Field>
              <div className="col-span-2">
                <EventPeopleFields people={people} />
              </div>
              <div className="col-span-2"><Field label="Description"><Textarea name="description" placeholder="Description" /></Field></div>
              <div className="col-span-2"><Field label="Markdown notes"><Textarea name="notes" placeholder="Markdown notes" /></Field></div>
              <div className="col-span-2"><TagMultiSelect tags={tags} onCreateTag={createTag} /></div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <FormSwitch label="Create another after save" />
              <Button type="submit"><FilePlus2 className="h-4 w-4" /> Add to chronology</Button>
            </div>
          </form>
        </div>
      )}

      {showEventModal && selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4">
          <div className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Maximize2 className="h-4 w-4 text-sky-300" />
                Event detail
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowEventModal(false)}>
                Close
              </Button>
            </div>
            <div className="min-h-0 overflow-y-auto">
              <EventInspector
                event={selectedEvent}
                relationships={relationships}
                allEvents={caseData.events}
                onUpload={uploadEvidence}
                onDelete={(eventId) => {
                  const item = caseData.events.find((candidate) => candidate.id === eventId);
                  if (item) setArchiveTarget({ type: "event", item });
                }}
                onEdit={(item) => setEditing({ type: "event", item })}
                onUpdateRelationship={updateEventRelationship}
                onDeleteRelationship={deleteEventRelationship}
                conversations={conversations}
                onGroupConversation={groupEventsIntoConversation}
                spacious
                tags={tags}
                onCreateTag={createTag}
                uploadProgress={evidenceUploadProgress}
              />
            </div>
          </div>
        </div>
      )}

      {showCaseManager && (
        <InvestigationManager
          cases={cases}
          activeCase={caseData}
          onClose={() => setShowCaseManager(false)}
          onSwitch={switchInvestigation}
          onCreate={() => setShowNewCase(true)}
          onEdit={() => setEditing({ type: "case", item: caseData })}
          onArchive={() => setArchiveTarget({ type: "case", item: caseData })}
          onDelete={deleteInvestigation}
        />
      )}

      {showNewCase && (
        <ModalShell title="Create investigation" onClose={() => setShowNewCase(false)}>
          <form onSubmit={createInvestigation} className="space-y-3">
            <Input name="title" placeholder="Name" required />
            <Textarea name="description" placeholder="Description" />
            <Input name="status" placeholder="Status" defaultValue="active" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNewCase(false)}>Cancel</Button>
              <Button type="submit"><Plus className="h-4 w-4" /> Create</Button>
            </div>
          </form>
        </ModalShell>
      )}

      {editing && (
        <EditModal
          editing={editing}
          people={people}
          events={caseData.events}
          evidence={evidence}
          tags={tags}
          onClose={() => setEditing(null)}
          onUpdateCase={updateInvestigation}
          onUpdateEvent={updateEvent}
          onUpdatePerson={updatePerson}
          onUpdateEvidence={updateEvidence}
          onUpdateAction={updateAction}
          onCreateTag={createTag}
        />
      )}

      {editingPersonRelationship && (
        <RelationshipEditModal
          relationship={editingPersonRelationship}
          people={people}
          onClose={() => setEditingPersonRelationship(null)}
          onUpdate={updatePersonRelationship}
        />
      )}

      {archiveTarget && (
        <ArchiveConfirmation
          target={archiveTarget}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={() => {
            if (archiveTarget.type === "event") void removeEvent(archiveTarget.item.id);
            else void archiveInvestigation(archiveTarget.item);
          }}
        />
      )}
    </main>
  );
}

function ResizeHandle({
  label,
  onPointerDown,
  onDoubleClick,
}: {
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className="group flex cursor-col-resize items-stretch justify-center bg-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      title={`${label}. Double-click to reset.`}
    >
      <div className="w-px bg-slate-800 transition-colors group-hover:bg-sky-400" />
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4">
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormSwitch({ label }: { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input name="createAnother" type="checkbox" className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-cyan-400" />
      {label}
    </label>
  );
}

function InvestigationManager({
  cases,
  activeCase,
  onClose,
  onSwitch,
  onCreate,
  onEdit,
  onArchive,
  onDelete,
}: {
  cases: CaseSummary[];
  activeCase: WorkspaceCase;
  onClose: () => void;
  onSwitch: (caseId: string) => void;
  onCreate: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: (caseId: string) => void;
}) {
  const active = cases.filter((item) => !item.deletedAt);
  const archived = cases.filter((item) => item.deletedAt);
  return (
    <ModalShell title="Investigations" onClose={onClose}>
      <div className="mb-4 flex justify-between gap-3">
        <div>
          <div className="text-sm text-slate-400">Current investigation</div>
          <div className="font-semibold text-sky-200">{activeCase.title}</div>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={onCreate}><Plus className="h-4 w-4" /> New</Button>
          <Button type="button" size="sm" variant="secondary" onClick={onEdit}><Edit3 className="h-4 w-4" /> Rename</Button>
          <Button type="button" size="sm" variant="danger" onClick={onArchive}><Archive className="h-4 w-4" /> Archive</Button>
        </div>
      </div>
      <CaseList title="Active investigations" cases={active} activeCaseId={activeCase.id} onSwitch={onSwitch} onDelete={onDelete} />
      <CaseList title="Archived investigations" cases={archived} activeCaseId={activeCase.id} onSwitch={onSwitch} onDelete={onDelete} />
    </ModalShell>
  );
}

function CaseList({
  title,
  cases,
  activeCaseId,
  onSwitch,
  onDelete,
}: {
  title: string;
  cases: CaseSummary[];
  activeCaseId: string;
  onSwitch: (caseId: string) => void;
  onDelete: (caseId: string) => void;
}) {
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="space-y-2">
        {cases.length === 0 && <div className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-500">None</div>}
        {cases.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSwitch(item.id)}>
              <div className="truncate font-medium">{item.title}</div>
              <div className="mt-1 text-xs text-slate-500">
                {item.status} | {item._count?.events ?? 0} events | {item._count?.documents ?? 0} evidence | {item._count?.actions ?? 0} actions
              </div>
            </button>
            {item.id === activeCaseId ? <Badge className="bg-sky-500/20 text-sky-100">Current</Badge> : <Button type="button" size="sm" variant="secondary" onClick={() => onSwitch(item.id)}>Switch</Button>}
            <Button type="button" size="icon" variant="ghost" title="Delete investigation" onClick={() => onDelete(item.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ArchiveConfirmation({
  target,
  onCancel,
  onConfirm,
}: {
  target: { type: "event"; item: EventItem } | { type: "case"; item: WorkspaceCase };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = target.item.title;
  const label = target.type === "case" ? "investigation" : "event";
  return (
    <ModalShell title={`Archive ${label}`} onClose={onCancel}>
      <p className="text-sm leading-6 text-slate-300">
        Archiving &quot;{name}&quot; hides it from the active workspace while preserving the audit trail and backups. You can keep working without a browser refresh after this completes.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="danger" onClick={onConfirm}><Archive className="h-4 w-4" /> Archive</Button>
      </div>
    </ModalShell>
  );
}

function EditModal({
  editing,
  people,
  events,
  evidence,
  tags,
  onClose,
  onUpdateCase,
  onUpdateEvent,
  onUpdatePerson,
  onUpdateEvidence,
  onUpdateAction,
  onCreateTag,
}: {
  editing: EditingItem;
  people: Person[];
  events: EventItem[];
  evidence: DocumentItem[];
  tags: Tag[];
  onClose: () => void;
  onUpdateCase: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateEvent: (event: FormEvent<HTMLFormElement>, item: EventItem) => void;
  onUpdatePerson: (event: FormEvent<HTMLFormElement>, item: Person) => void;
  onUpdateEvidence: (event: FormEvent<HTMLFormElement>, item: DocumentItem) => void;
  onUpdateAction: (event: FormEvent<HTMLFormElement>, item: ActionItem) => void;
  onCreateTag: (name: string, colour: string) => Promise<Tag>;
}) {
  const title = `Edit ${editing.type}`;
  if (editing.type === "case") {
    return (
      <ModalShell title={title} onClose={onClose}>
        <form onSubmit={onUpdateCase} className="space-y-3">
          <Input name="title" defaultValue={editing.item.title} required />
          <Textarea name="description" defaultValue={editing.item.description} />
          <Input name="status" defaultValue={editing.item.status} />
          <EditActions onClose={onClose} />
        </form>
      </ModalShell>
    );
  }
  if (editing.type === "event") {
    return (
      <ModalShell title={title} onClose={onClose}>
        <form onSubmit={(event) => onUpdateEvent(event, editing.item)} className="space-y-3">
          <Field label="Title"><Input name="title" defaultValue={editing.item.title} required /></Field>
          <Field label="Date and time"><Input name="startDate" type="datetime-local" defaultValue={format(dateOf(editing.item.startDate), "yyyy-MM-dd'T'HH:mm")} required /></Field>
          <Field label="Event type"><select name="eventType" defaultValue={editing.item.eventType} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{eventTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Category"><select name="category" defaultValue={editing.item.category} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{eventCategories.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Importance"><select name="importance" defaultValue={editing.item.importance} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option>medium</option><option>high</option><option>critical</option><option>low</option></select></Field>
          <Field label="Status"><select name="status" defaultValue={editing.item.status} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{eventStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field>
          <EventPeopleFields people={people} initialLinks={editing.item.people.map((item) => ({ personId: item.person.id, role: item.role }))} />
          <Field label="Description"><Textarea name="description" defaultValue={editing.item.description} /></Field>
          <Field label="Markdown notes"><Textarea name="notes" defaultValue={editing.item.notes} /></Field>
          <TagMultiSelect tags={tags} defaultSelectedIds={editing.item.tags.map((link) => link.tag.id)} onCreateTag={onCreateTag} />
          <EditActions onClose={onClose} />
        </form>
      </ModalShell>
    );
  }
  if (editing.type === "person") {
    return (
      <ModalShell title={title} onClose={onClose}>
        <form onSubmit={(event) => onUpdatePerson(event, editing.item)} className="space-y-3">
          <Input name="name" defaultValue={editing.item.name} required />
          <Input name="role" defaultValue={editing.item.role} />
          <Input name="organisation" defaultValue={editing.item.organisation} />
          <Textarea name="notes" defaultValue={editing.item.notes} />
          <EditActions onClose={onClose} />
        </form>
      </ModalShell>
    );
  }
  if (editing.type === "evidence") {
    return (
      <ModalShell title={title} onClose={onClose}>
        <form onSubmit={(event) => onUpdateEvidence(event, editing.item)} className="space-y-3">
          <Input name="title" defaultValue={editing.item.title} required />
          <Textarea name="description" defaultValue={editing.item.description} />
          <select name="sourceType" defaultValue={editing.item.sourceType} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{sourceTypes.map((item) => <option key={item}>{item}</option>)}</select>
          <Input name="sourceReference" defaultValue={editing.item.sourceReference} />
          <select name="confidenceLevel" defaultValue={editing.item.confidenceLevel} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{confidenceLevels.map((item) => <option key={item}>{item}</option>)}</select>
          <EventChecklist name="eventIds" events={events} selectedIds={editing.item.events?.map((link) => link.event.id) ?? []} />
          <select name="personId" defaultValue={editing.item.people?.[0]?.person.id ?? ""} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">No person link</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
          <TagMultiSelect tags={tags} defaultSelectedIds={editing.item.tags.map((link) => link.tag.id)} onCreateTag={onCreateTag} />
          <EditActions onClose={onClose} />
        </form>
      </ModalShell>
    );
  }
  return (
    <ModalShell title={title} onClose={onClose}>
      <form onSubmit={(event) => onUpdateAction(event, editing.item)} className="space-y-3">
        <Input name="title" defaultValue={editing.item.title} required />
        <Textarea name="description" defaultValue={editing.item.description} />
        <Input name="dueDate" type="date" defaultValue={format(dateOf(editing.item.dueDate), "yyyy-MM-dd")} required />
        <select name="status" defaultValue={editing.item.status} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{actionStatuses.map((status) => <option key={status}>{status}</option>)}</select>
        <select name="ownerId" defaultValue={editing.item.ownerId ?? ""} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">No owner</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        <select name="eventId" defaultValue={editing.item.eventId ?? ""} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">No linked event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select>
        <select name="documentId" defaultValue={editing.item.documentId ?? ""} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">No linked evidence</option>{evidence.map((item) => <option key={item.id} value={item.id}>{item.title || item.filename}</option>)}</select>
        <EditActions onClose={onClose} />
      </form>
    </ModalShell>
  );
}

function RelationshipEditModal({
  relationship,
  people,
  onClose,
  onUpdate,
}: {
  relationship: PersonRelationship;
  people: Person[];
  onClose: () => void;
  onUpdate: (event: FormEvent<HTMLFormElement>, relationship: PersonRelationship) => void;
}) {
  return (
    <ModalShell title="Edit relationship" onClose={onClose}>
      <form onSubmit={(event) => onUpdate(event, relationship)} className="space-y-4">
        <Field label="From person (manager/source)">
          <select name="sourceId" defaultValue={relationship.sourceId} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </Field>
        <Field label="To person (direct report/target)">
          <select name="targetId" defaultValue={relationship.targetId} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </Field>
        <Field label="Relationship type">
          <select name="relationshipType" defaultValue={relationship.relationshipType} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">
            {[...new Set([relationship.relationshipType, ...personRelationshipTypes])].map((type) => <option key={type}>{type}</option>)}
          </select>
        </Field>
        <Field label="Notes">
          <Textarea name="notes" defaultValue={relationship.notes} />
        </Field>
        <EditActions onClose={onClose} />
      </form>
    </ModalShell>
  );
}

function EventPeopleFields({
  people,
  initialLinks,
}: {
  people: Person[];
  initialLinks?: Array<{ personId: string; role: string }>;
}) {
  const [rows, setRows] = useState(() => {
    if (initialLinks?.length) {
      return initialLinks.map((link, index) => ({
        id: `${link.personId}-${index}`,
        personId: link.personId,
        role: link.role || "Involved",
      }));
    }
    return [
      { id: "new-from", personId: "", role: "From" },
      { id: "new-to", personId: "", role: "To" },
      { id: "new-cc", personId: "", role: "CC" },
    ];
  });

  function updateRow(rowId: string, patch: Partial<{ personId: string; role: string }>) {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, { id: `event-person-${crypto.randomUUID()}`, personId: "", role: "Involved" }]);
  }

  function removeRow(rowId: string) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== rowId) : [{ ...current[0], personId: "", role: "Involved" }]));
  }

  return (
    <section className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">People involved</div>
          <p className="mt-1 text-xs text-slate-400">Add each person and their role in this event, for example From, To, CC, HR, or Witness.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" /> Add person
        </Button>
      </div>
      <datalist id="event-person-role-options">
        {eventPersonRoles.map((role) => <option key={role} value={role} />)}
      </datalist>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_2.5rem] gap-2">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Person {index + 1}</span>
              <select
                name="eventPersonId"
                value={row.personId}
                onChange={(event) => updateRow(row.id, { personId: event.target.value })}
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
              >
                <option value="">No person selected</option>
                {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Role / why</span>
              <Input
                name="eventPersonRole"
                value={row.role}
                list="event-person-role-options"
                placeholder="From, To, CC, HR"
                onChange={(event) => updateRow(row.id, { role: event.target.value })}
              />
            </label>
            <div className="flex items-end">
              <Button type="button" variant="ghost" size="icon" title="Remove person link" onClick={() => removeRow(row.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EventChecklist({
  name,
  events,
  selectedIds = [],
  compact = false,
}: {
  name: string;
  events: EventItem[];
  selectedIds?: string[];
  compact?: boolean;
}) {
  const selected = new Set(selectedIds);
  return (
    <section className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Linked events</div>
      <div className={cn("space-y-2 overflow-auto pr-1", compact ? "max-h-40" : "max-h-56")}>
        {events.length === 0 && <p className="text-sm text-slate-500">No events available.</p>}
        {events.map((event) => (
          <label key={event.id} className="flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950 p-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={event.id}
              defaultChecked={selected.has(event.id)}
              className="mt-1 h-4 w-4 shrink-0 accent-cyan-400"
            />
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-200">{event.title}</span>
              <span className="block text-xs text-slate-500">{format(dateOf(event.startDate), "dd MMM yyyy HH:mm")} | {event.eventType}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function EditActions({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      <Button type="submit"><CheckCircle2 className="h-4 w-4" /> Save</Button>
    </div>
  );
}

function NodeLabel({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="min-w-36 max-w-48">
      <div className="text-[11px] font-bold uppercase opacity-70">{eyebrow}</div>
      <div className="mt-1 truncate text-sm font-semibold">{title}</div>
      <div className="mt-1 truncate text-xs opacity-70">{detail}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="font-mono text-xl text-sky-200">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Dashboard({
  caseData,
  evidence,
  actions,
  insights,
  conversations,
  now,
  onOpenImport,
}: {
  caseData: { events: EventItem[]; actions: ActionItem[] };
  evidence: DocumentItem[];
  actions: ActionItem[];
  insights: CaseInsight[];
  conversations: ConversationItem[];
  now: Date;
  onOpenImport: () => void;
}) {
  const openActions = actions.filter((action) => !["Completed", "Cancelled"].includes(action.status));
  const overdue = openActions.filter((action) => dateOf(action.dueDate) < now);
  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid grid-cols-5 gap-3">
        <Metric label="Chronology" value={caseData.events.length} />
        <Metric label="Evidence register" value={evidence.length} />
        <Metric label="Conversations" value={conversations.length} />
        <Metric label="Open actions" value={openActions.length} />
        <Metric label="Overdue" value={overdue.length} />
      </div>
      <div className="mt-6 grid grid-cols-[1.1fr_0.9fr] gap-5">
        <Panel title="Case health insights">
          <div className="mb-3 flex justify-end">
            <Button type="button" size="sm" onClick={onOpenImport}>
              <Upload className="h-4 w-4" /> Investigation Import
            </Button>
          </div>
          <div className="space-y-3">
            {insights.length === 0 && <p className="text-sm text-slate-400">No automatic risks detected from the current case data.</p>}
            {insights.map((insight) => (
              <div key={insight.id} className="rounded-md border border-slate-800 bg-slate-950 p-3">
                <Badge className={insight.severity === "critical" ? "bg-red-500/20 text-red-100" : insight.severity === "warning" ? "bg-amber-500/20 text-amber-100" : "bg-sky-500/20 text-sky-100"}>{insight.severity}</Badge>
                <div className="mt-2 font-medium">{insight.title}</div>
                <p className="mt-1 text-sm text-slate-400">{insight.detail}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Outstanding actions">
          <div className="space-y-2">
            {openActions.slice(0, 8).map((action) => (
              <div key={action.id} className="rounded-md bg-slate-950 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{action.title}</span>
                  <Badge className={statusColour(action.status)}>{action.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-slate-500">Due {format(dateOf(action.dueDate), "dd MMM yyyy")}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function EvidenceDashboard({
  evidence,
  events,
  people,
  tags,
  source,
  setSource,
  confidence,
  setConfidence,
  onCreate,
  onOpenImport,
  onEdit,
  onDelete,
  onCreateTag,
  uploadProgress,
}: {
  evidence: DocumentItem[];
  events: EventItem[];
  people: Person[];
  tags: Tag[];
  source: string;
  setSource: (value: string) => void;
  confidence: string;
  setConfidence: (value: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onOpenImport: () => void;
  onEdit: (item: DocumentItem) => void;
  onDelete: (item: DocumentItem) => void;
  onCreateTag: (name: string, colour: string) => Promise<Tag>;
  uploadProgress: number | null;
}) {
  const bySource = evidence.reduce<Record<string, number>>((acc, item) => {
    acc[item.sourceType] = (acc[item.sourceType] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[1fr_340px]">
      <div className="overflow-auto p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold">Evidence register</h2><p className="text-sm text-slate-400">{evidence.length} searchable evidence items</p></div>
          <div className="flex gap-2">
            <select value={source} onChange={(event) => setSource(event.target.value)} className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="all">All sources</option>{sourceTypes.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={confidence} onChange={(event) => setConfidence(event.target.value)} className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="all">All confidence</option>{confidenceLevels.map((item) => <option key={item}>{item}</option>)}</select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Evidence" value={evidence.length} />
          <Metric label="Confirmed" value={evidence.filter((item) => item.confidenceLevel === "Confirmed").length} />
          <Metric label="Independent" value={evidence.filter((item) => !item.events?.length).length} />
        </div>
        <div className="mt-5 grid gap-3">
          {evidence.length === 0 && <p className="rounded-md border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No evidence matches the current search or filters.</p>}
          {evidence.map((item) => (
            <div key={item.id} className="rounded-md border border-slate-800 bg-slate-900 p-4 hover:border-sky-500">
              <div className="flex flex-wrap items-start justify-between gap-3">
                {item.path ? <a href={`/api/evidence/${encodeURIComponent(item.id)}/download`} target="_blank" rel="noreferrer" className="min-w-0 flex-1"><h3 className="font-semibold">{item.title || item.filename}</h3><p className="mt-1 text-sm text-slate-400">{item.description}</p></a> : <div className="min-w-0 flex-1"><h3 className="font-semibold">{item.title || item.filename}</h3><p className="mt-1 text-sm text-slate-400">{item.description}</p><p className="mt-1 text-xs text-amber-300">No stored file is attached to this evidence record.</p></div>}
                <div className="flex gap-2"><Badge className="bg-slate-800 text-slate-200">{item.sourceType}</Badge><Badge className="bg-sky-500/20 text-sky-100">{item.confidenceLevel}</Badge><Button type="button" size="icon" variant="ghost" title="Edit evidence" onClick={() => onEdit(item)}><Edit3 className="h-4 w-4" /></Button><Button type="button" size="icon" variant="ghost" title="Delete evidence" onClick={() => onDelete(item)}><Trash2 className="h-4 w-4" /></Button></div>
              </div>
              <div className="mt-3 text-xs text-slate-500">{item.sourceReference || item.filename} | Uploaded {format(dateOf(item.uploadedAt), "dd MMM yyyy")}</div>
              {item.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{item.tags.map((link) => <TagBadge key={link.tag.id} tag={link.tag} />)}</div>}
            </div>
          ))}
        </div>
      </div>
      <aside className="overflow-auto border-t border-slate-800 p-5 xl:border-l xl:border-t-0">
        <Panel title="Investigation Import">
          <div className="space-y-3">
            <p className="text-sm leading-6 text-slate-400">Upload communications and generate conversations, evidence, people, chronology, and relationships.</p>
            <Button type="button" size="sm" onClick={onOpenImport}>
              <Upload className="h-4 w-4" /> Open import wizard
            </Button>
          </div>
        </Panel>
        <Panel title="Add evidence">
          <form onSubmit={onCreate} className="space-y-3">
            <Input name="title" placeholder="Evidence title" required />
            <Input type="file" name="file" accept={EVIDENCE_FILE_ACCEPT} />
            <p className="text-xs text-slate-500">Documents, images, audio and video up to 4 MB; ZIP evidence up to 500 MB.</p>
            <Textarea name="description" placeholder="Description" />
            <select name="sourceType" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{sourceTypes.map((item) => <option key={item}>{item}</option>)}</select>
            <Input name="sourceReference" placeholder="Source reference" />
            <select name="confidenceLevel" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{confidenceLevels.map((item) => <option key={item}>{item}</option>)}</select>
            <EventChecklist name="eventIds" events={events} />
            <select name="personId" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">No person link</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            <TagMultiSelect tags={tags} onCreateTag={onCreateTag} />
            <FormSwitch label="Create another after save" />
            <Button type="submit" size="sm" disabled={uploadProgress !== null}><Plus className="h-4 w-4" /> {uploadProgress === null ? "Add evidence" : `Uploading ${Math.round(uploadProgress)}%`}</Button>
          </form>
        </Panel>
        <Panel title="By source">
          <Breakdown values={bySource} />
        </Panel>
      </aside>
    </div>
  );
}

function InvestigationImport({
  caseId,
  conversations,
  importJobs,
  onImported,
}: {
  caseId: string;
  conversations: ConversationItem[];
  importJobs: WorkspaceData["importJobs"];
  onImported: () => Promise<WorkspaceData>;
}) {
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const recentImport = importJobs[0];
  const generatedConversations = conversations.filter((conversation) => conversation.importJobId === recentImport?.id);

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const files = form.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
    if (!files.length) {
      toast.error("Select at least one import file");
      return;
    }
    form.set("caseId", caseId);
    setBusy(true);
    setStep(2);
    try {
      const response = await fetch("/api/import/preview", { method: "POST", body: form });
      if (!response.ok) throw new Error(await evidenceApiErrorMessage(response, "The import upload could not be analysed."));
      const data = (await response.json()) as ImportPreviewState;
      setPreview(data);
      setIgnored(new Set(data.events.filter((item) => item.duplicate).map((item) => item.localId)));
      setStep(3);
      toast.success("Communications detected");
    } catch (error) {
      setStep(1);
      toast.error(uploadNetworkErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!preview) return;
    setBusy(true);
    setStep(5);
    try {
      const response = await fetch("/api/import/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: preview.jobId, ignoredMessageIds: [...ignored] }),
      });
      if (!response.ok) throw new Error(await evidenceApiErrorMessage(response, "The import could not be approved."));
      await onImported();
      setStep(6);
      toast.success("Investigation records generated");
    } catch (error) {
      toast.error(uploadNetworkErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function toggleIgnored(id: string) {
    setIgnored((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Investigation Import</h2>
          <p className="text-sm text-slate-400">TXT, PDF, EML, MBOX, and DOCX communications</p>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className={cn("h-2 w-10 rounded bg-slate-800", step >= item && "bg-sky-400")} title={`Step ${item}`} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5">
        <div className="space-y-5">
          <Panel title="1. Upload file(s)">
            <form onSubmit={previewImport} className="space-y-4">
              <Input name="files" type="file" accept=".txt,.pdf,.eml,.mbox,.docx" multiple />
              <p className="text-xs text-slate-500">PDF, EML, MBOX, DOCX or TXT files, up to 4 MB total.</p>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  <Upload className="h-4 w-4" /> Detect communications
                </Button>
              </div>
            </form>
          </Panel>

          <Panel title="2. Detect communications">
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Messages" value={preview?.summary.messages ?? (busy ? "..." : 0)} />
              <Metric label="Threads" value={preview?.summary.conversations ?? 0} />
              <Metric label="Duplicates" value={preview?.summary.duplicates ?? 0} />
              <Metric label="Relationships" value={preview?.summary.relationships ?? 0} />
            </div>
          </Panel>

          {preview && (
            <>
              <Panel title="3. Preview extracted information">
                <div className="space-y-3">
                  {preview.conversations.map((conversation) => (
                    <div key={conversation.localId} className="rounded-md border border-slate-800 bg-slate-950 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{conversation.title}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {format(parseISO(conversation.startedAt), "dd MMM yyyy HH:mm")} to {format(parseISO(conversation.endedAt), "dd MMM yyyy HH:mm")}
                          </div>
                        </div>
                        <Badge className="bg-sky-500/20 text-sky-100">{conversation.messageCount} messages</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {conversation.participants.map((participant) => <Badge key={participant} className="bg-slate-800 text-slate-200">{participant}</Badge>)}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="4. Review suggested entities">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">People Found</h3>
                    <div className="space-y-2">
                      {preview.people.map((person) => (
                        <div key={`${person.email}-${person.name}`} className="rounded-md border border-slate-800 bg-slate-950 p-3">
                          <div className="font-medium">{person.name}</div>
                          <div className="text-xs text-slate-500">{person.email || "No email"} {person.existingPersonId ? "| existing match" : "| new person"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Events Found</h3>
                    <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
                      {preview.events.map((event) => (
                        <label key={event.localId} className={cn("block rounded-md border p-3", ignored.has(event.localId) ? "border-slate-800 bg-slate-950/50 opacity-60" : "border-slate-700 bg-slate-950")}>
                          <div className="flex items-start gap-3">
                            <input type="checkbox" checked={!ignored.has(event.localId)} disabled={event.duplicate} onChange={() => toggleIgnored(event.localId)} className="mt-1 h-4 w-4 accent-cyan-400" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{event.title}</div>
                              <div className="mt-1 text-xs text-slate-500">{format(parseISO(event.date), "dd MMM yyyy HH:mm")} | {event.eventType} | {event.category}</div>
                              <div className="mt-2 flex gap-2">
                                <Badge className={importanceColour(event.priority.toLowerCase())}>{event.priority}</Badge>
                                <Badge className="bg-slate-800 text-slate-200">{event.confidence}%</Badge>
                                {event.duplicate && <Badge className="bg-amber-500/20 text-amber-100">duplicate</Badge>}
                              </div>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="5. Approve import">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-slate-400">
                    {preview.events.length - ignored.size} events and evidence records will be generated from {preview.conversations.length} conversations.
                  </div>
                  <Button type="button" disabled={busy || preview.events.length === ignored.size} onClick={approve}>
                    <CheckCircle2 className="h-4 w-4" /> Generate investigation records
                  </Button>
                </div>
              </Panel>
            </>
          )}

          {step === 6 && (
            <Panel title="6. Generated records">
              <div className="grid grid-cols-4 gap-3">
                <Metric label="Conversations" value={generatedConversations.length || preview?.summary.conversations || 0} />
                <Metric label="Evidence" value={preview ? preview.summary.evidence - preview.summary.duplicates - ignored.size : 0} />
                <Metric label="Events" value={preview ? preview.summary.events - preview.summary.duplicates - ignored.size : 0} />
                <Metric label="People reviewed" value={preview?.summary.people ?? 0} />
              </div>
            </Panel>
          )}
        </div>

        <aside className="space-y-5">
          <Panel title="Communication analytics">
            <div className="space-y-3">
              {preview
                ? preview.conversations.map((conversation) => (
                    <ConversationMetricCard
                      key={conversation.localId}
                      title={conversation.title}
                      averageResponseHours={conversation.analytics.averageResponseHours}
                      longestResponseHours={conversation.analytics.longestResponseHours}
                      followUpsRequired={conversation.analytics.followUpsRequired}
                      periodsOfSilence={conversation.analytics.periodsOfSilence}
                    />
                  ))
                : generatedConversations.slice(0, 6).map((conversation) => (
                    <ConversationMetricCard
                      key={conversation.id}
                      title={conversation.title}
                      averageResponseHours={conversation.averageResponseHours}
                      longestResponseHours={conversation.longestResponseHours}
                      followUpsRequired={conversation.followUpsRequired}
                      periodsOfSilence={conversation.periodsOfSilence}
                    />
                  ))}
              {!preview && !generatedConversations.length && <p className="text-sm text-slate-400">No imported conversations yet.</p>}
            </div>
          </Panel>
          <Panel title="Machine-generated observations">
            <div className="space-y-2">
              {(preview?.insights ?? []).map((insight) => (
                <div key={insight} className="rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">{insight}</div>
              ))}
              {preview && preview.insights.length === 0 && <p className="text-sm text-slate-400">No import observations detected.</p>}
              {!preview && importJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="rounded-md border border-slate-800 bg-slate-950 p-3">
                  <div className="text-sm font-medium">{job.sourceType}</div>
                  <div className="mt-1 text-xs text-slate-500">{job.status} | {job.messageCount} messages | {format(dateOf(job.createdAt), "dd MMM yyyy HH:mm")}</div>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function ConversationMetricCard({
  title,
  averageResponseHours,
  longestResponseHours,
  followUpsRequired,
  periodsOfSilence,
}: {
  title: string;
  averageResponseHours: number;
  longestResponseHours: number;
  followUpsRequired: number;
  periodsOfSilence: number;
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="truncate text-sm font-medium">{title}</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Metric label="Avg response hrs" value={averageResponseHours} />
        <Metric label="Longest hrs" value={longestResponseHours} />
        <Metric label="Follow ups" value={followUpsRequired} />
        <Metric label="Silences" value={periodsOfSilence} />
      </div>
    </div>
  );
}

function PeoplePage({
  people,
  events,
  evidence,
  relationships,
  selectedPersonId,
  setSelectedPersonId,
  onCreatePerson,
  onCreateRelationship,
  onEditRelationship,
  onDeleteRelationship,
  onEditPerson,
  onDeletePerson,
}: {
  people: Person[];
  events: EventItem[];
  evidence: DocumentItem[];
  relationships: PersonRelationship[];
  selectedPersonId: string;
  setSelectedPersonId: (id: string) => void;
  onCreatePerson: (event: FormEvent<HTMLFormElement>) => void;
  onCreateRelationship: (event: FormEvent<HTMLFormElement>) => void;
  onEditRelationship: (relationship: PersonRelationship) => void;
  onDeleteRelationship: (relationship: PersonRelationship) => void;
  onEditPerson: (item: Person) => void;
  onDeletePerson: (item: Person) => void;
}) {
  const selected = people.find((person) => person.id === selectedPersonId) ?? people[0];
  const personEvents = selected ? events.filter((event) => event.people.some((item) => item.person.id === selected.id)) : [];
  const personEvidence = selected ? evidence.filter((item) => item.people?.some((person) => person.person.id === selected.id)) : [];
  const linkedPeople = selected ? relationships.filter((item) => item.sourceId === selected.id || item.targetId === selected.id) : [];
  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_1fr_340px]">
      <aside className="overflow-auto border-r border-slate-800 p-4">
        <h2 className="mb-3 font-semibold">People</h2>
        <div className="space-y-2">{people.map((person) => <button key={person.id} onClick={() => setSelectedPersonId(person.id)} className={cn("w-full rounded-md border p-3 text-left", selected?.id === person.id ? "border-emerald-400 bg-emerald-400/10" : "border-slate-800 bg-slate-950")}><div className="font-medium">{person.name}</div><div className="text-xs text-slate-500">{person.role}</div></button>)}</div>
      </aside>
      <div className="overflow-auto p-6">
        {selected && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{selected.name}</h2>
                <p className="mt-1 text-sm text-slate-400">{selected.role} | {selected.organisation}</p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => onEditPerson(selected)}>
                <Edit3 className="h-4 w-4" /> Edit
              </Button>
              <Button type="button" size="sm" variant="danger" onClick={() => onDeletePerson(selected)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">{selected.notes}</p>
            <Panel title="People timeline">
              <div className="space-y-3">
                {[...personEvents.map((event) => ({ type: "Event", date: dateOf(event.startDate), title: event.title, detail: event.description })), ...personEvidence.map((item) => ({ type: "Evidence", date: dateOf(item.uploadedAt), title: item.title || item.filename, detail: item.description }))].sort((a, b) => a.date.getTime() - b.date.getTime()).map((item, index) => (
                  <div key={`${item.type}-${index}`} className="rounded-md border border-slate-800 bg-slate-950 p-3">
                    <div className="flex items-center justify-between gap-3"><span className="font-medium">{item.title}</span><Badge className="bg-slate-800 text-slate-200">{item.type}</Badge></div>
                    <div className="mt-1 font-mono text-xs text-sky-200">{format(item.date, "dd MMM yyyy HH:mm")}</div>
                    <p className="mt-2 text-sm text-slate-400">{item.detail}</p>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Relationships">
              <div className="space-y-2">{linkedPeople.map((link) => {
                const other = people.find((person) => person.id === (link.sourceId === selected.id ? link.targetId : link.sourceId));
                const label = link.sourceId === selected.id ? link.relationshipType : inverseRelationshipLabel(link.relationshipType);
                return (
                  <div key={link.id} className="rounded-md bg-slate-950 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm">{other?.name}</div>
                        <div className="text-xs text-emerald-300">{label}</div>
                        {link.notes && <div className="mt-1 text-xs text-slate-500">{link.notes}</div>}
                      </div>
                      <div className="flex gap-1">
                        <Button type="button" size="icon" variant="ghost" title="Edit relationship" onClick={() => onEditRelationship(link)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" title="Delete relationship" onClick={() => onDeleteRelationship(link)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}</div>
            </Panel>
          </>
        )}
      </div>
      <aside className="overflow-auto border-l border-slate-800 p-5">
        <Panel title="Add person">
          <form onSubmit={onCreatePerson} className="space-y-3">
            <Input name="name" placeholder="Name" required /><Input name="role" placeholder="Role" /><Input name="organisation" placeholder="Organisation" /><Textarea name="notes" placeholder="Notes" /><FormSwitch label="Create another after save" /><Button type="submit" size="sm"><Plus className="h-4 w-4" /> Add person</Button>
          </form>
        </Panel>
        <Panel title="Link people">
          <form onSubmit={onCreateRelationship} className="space-y-3">
            <Field label="From person (manager/source)">
              <select name="sourceId" defaultValue={selected?.id} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            </Field>
            <Field label="To person (direct report/target)">
              <select name="targetId" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            </Field>
            <Field label="Relationship type">
              <select name="relationshipType" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{personRelationshipTypes.map((type) => <option key={type}>{type}</option>)}</select>
            </Field>
            <Field label="Notes"><Textarea name="notes" placeholder="Relationship notes" /></Field><Button type="submit" size="sm"><Link2 className="h-4 w-4" /> Link</Button>
          </form>
        </Panel>
      </aside>
    </div>
  );
}

function ActionDashboard({ actions, events, evidence, people, now, onCreate, onStatus, onEdit, onDelete }: { actions: ActionItem[]; events: EventItem[]; evidence: DocumentItem[]; people: Person[]; now: Date; onCreate: (event: FormEvent<HTMLFormElement>) => void; onStatus: (action: ActionItem, status: string) => void; onEdit: (action: ActionItem) => void; onDelete: (action: ActionItem) => void }) {
  const overdue = actions.filter((action) => !["Completed", "Cancelled"].includes(action.status) && dateOf(action.dueDate) < now);
  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_340px]">
      <div className="overflow-auto p-6">
        <div className="grid grid-cols-4 gap-3"><Metric label="Actions" value={actions.length} /><Metric label="Open" value={actions.filter((a) => a.status === "Open").length} /><Metric label="Waiting" value={actions.filter((a) => a.status === "Waiting").length} /><Metric label="Overdue" value={overdue.length} /></div>
        <div className="mt-5 grid gap-3">
          {actions.map((action) => (
            <div key={action.id} className="rounded-md border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{action.title}</h3><p className="mt-1 text-sm text-slate-400">{action.description}</p></div><div className="flex gap-2"><select value={action.status} onChange={(event) => onStatus(action, event.target.value)} className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{actionStatuses.map((status) => <option key={status}>{status}</option>)}</select><Button type="button" size="icon" variant="ghost" title="Edit action" onClick={() => onEdit(action)}><Edit3 className="h-4 w-4" /></Button><Button type="button" size="icon" variant="ghost" title="Delete action" onClick={() => onDelete(action)}><Trash2 className="h-4 w-4" /></Button></div></div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><Badge className={statusColour(action.status)}>{action.status}</Badge><span>Due {format(dateOf(action.dueDate), "dd MMM yyyy")}</span><span>{action.owner?.name ?? "No owner"}</span><span>{action.event?.title ?? "No event"}</span></div>
            </div>
          ))}
        </div>
      </div>
      <aside className="overflow-auto border-l border-slate-800 p-5">
        <Panel title="Add action">
          <form onSubmit={onCreate} className="space-y-3">
            <Input name="title" placeholder="Action title" required /><Textarea name="description" placeholder="Description" /><Input name="dueDate" type="date" required />
            <select name="status" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{actionStatuses.map((status) => <option key={status}>{status}</option>)}</select>
            <select name="ownerId" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">No owner</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
            <select name="eventId" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">No linked event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select>
            <select name="documentId" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="">No linked evidence</option>{evidence.map((item) => <option key={item.id} value={item.id}>{item.title || item.filename}</option>)}</select>
            <FormSwitch label="Create another after save" />
            <Button type="submit" size="sm"><Plus className="h-4 w-4" /> Add action</Button>
          </form>
        </Panel>
      </aside>
    </div>
  );
}

function EventInspector({
  event,
  relationships,
  allEvents,
  onUpload,
  onDelete,
  onEdit,
  onUpdateRelationship,
  onDeleteRelationship,
  conversations,
  onGroupConversation,
  onOpenFull,
  tags,
  onCreateTag,
  uploadProgress,
  spacious = false,
}: {
  event?: EventItem;
  relationships: Relationship[];
  allEvents: EventItem[];
  onUpload: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (eventId: string) => void;
  onEdit: (event: EventItem) => void;
  onUpdateRelationship: (relationship: Relationship, relationshipType: string) => void;
  onDeleteRelationship: (relationship: Relationship) => void;
  conversations: ConversationItem[];
  onGroupConversation: (event: FormEvent<HTMLFormElement>) => void;
  onOpenFull?: () => void;
  tags: Tag[];
  onCreateTag: (name: string, colour: string) => Promise<Tag>;
  uploadProgress: number | null;
  spacious?: boolean;
}) {
  if (!event) return <div className="p-5 text-sm text-slate-400">Select an event to inspect evidence and links.</div>;
  const linked = relationships.filter((relationship) => relationship.sourceId === event.id || relationship.targetId === event.id).map((relationship) => ({ relationship, other: allEvents.find((item) => item.id === (relationship.sourceId === event.id ? relationship.targetId : relationship.sourceId)) }));
  return (
    <div className={cn(spacious ? "p-6" : "p-5")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          <PanelRight className="h-3.5 w-3.5" /> Context
        </div>
        <div className="flex items-center gap-2">
          {onOpenFull && (
            <Button type="button" variant="secondary" size="sm" onClick={onOpenFull} title="Open event detail">
              <Maximize2 className="h-4 w-4" /> Open
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => onEdit(event)}>
            <Edit3 className="h-4 w-4" /> Edit
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={() => onDelete(event.id)}>
            <Archive className="h-4 w-4" /> Archive
          </Button>
        </div>
      </div>
      <h2 className="break-words text-xl font-semibold">{event.title}</h2>
      <div className="mt-2 font-mono text-sm text-sky-200">{format(dateOf(event.startDate), "dd MMM yyyy HH:mm")}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Badge className={cn("ring-1", importanceColour(event.importance))}>{event.importance}</Badge><Badge className="bg-slate-800 text-slate-300">{event.status}</Badge><Badge className="bg-slate-800 text-slate-300">{event.eventType}</Badge><Badge className="bg-slate-800 text-slate-300">{event.category}</Badge></div>
      {event.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{event.tags.map((link) => <TagBadge key={link.tag.id} tag={link.tag} />)}</div>}
      <p className="mt-4 text-sm leading-6 text-slate-300">{event.description}</p>
      <Section title="People involved"><div className="space-y-2">{event.people.map((item) => <div key={item.person.id} className="rounded-md bg-slate-950 p-3"><div className="font-medium">{item.person.name}</div><div className="text-xs text-slate-400">{item.role} | {item.person.role || "No job role"} | {item.person.organisation}</div></div>)}</div></Section>
      <Section title="Notes"><div className="prose prose-invert prose-sm max-w-none rounded-md bg-slate-950 p-3 text-slate-300"><ReactMarkdown remarkPlugins={[remarkGfm]}>{event.notes || "_No notes recorded._"}</ReactMarkdown></div></Section>
      <Section title="Evidence"><div className="space-y-2">{event.documents.map((item) => item.document.path ? <a key={item.document.id} href={`/api/evidence/${encodeURIComponent(item.document.id)}/download`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950 p-3 hover:border-sky-500"><Download className="h-4 w-4 text-sky-300" /><div className="min-w-0"><div className="truncate text-sm">{item.document.title || item.document.filename}</div><div className="truncate text-xs text-slate-500">{item.document.description}</div></div></a> : <div key={item.document.id} className="rounded-md border border-amber-900/70 bg-slate-950 p-3"><div className="truncate text-sm">{item.document.title || item.document.filename}</div><div className="text-xs text-amber-300">Stored file missing or not attached</div></div>)}</div>
        <form onSubmit={onUpload} className="mt-3 space-y-2"><Input name="title" placeholder="Evidence title" /><Input type="file" name="file" accept={EVIDENCE_FILE_ACCEPT} required /><p className="text-xs text-slate-500">Documents, images, audio and video up to 4 MB; ZIP evidence up to 500 MB.</p>{uploadProgress !== null && <p className="text-xs text-sky-300" aria-live="polite">Uploading {Math.round(uploadProgress)}%</p>}<Textarea name="description" placeholder="Evidence description" /><select name="sourceType" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{sourceTypes.map((item) => <option key={item}>{item}</option>)}</select><Input name="sourceReference" placeholder="Source reference" /><select name="confidenceLevel" className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">{confidenceLevels.map((item) => <option key={item}>{item}</option>)}</select><EventChecklist name="eventIds" events={allEvents} selectedIds={[event.id]} compact /><TagMultiSelect tags={tags} onCreateTag={onCreateTag} /><Button type="submit" variant="secondary" size="sm" disabled={uploadProgress !== null}><Upload className="h-4 w-4" /> {uploadProgress === null ? "Upload evidence" : `Uploading ${Math.round(uploadProgress)}%`}</Button></form></Section>
      <Section title="Conversation">
        <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
          <div className="mb-3 text-sm text-slate-300">
            {event.conversation ? <>Current conversation: <span className="font-medium text-sky-200">{event.conversation.title}</span></> : "This event is not grouped into a conversation yet."}
          </div>
          <form onSubmit={onGroupConversation} className="space-y-3">
            <Input name="title" placeholder="New conversation title" defaultValue={event.conversation?.title ?? event.title} />
            <select name="conversationId" defaultValue={event.conversationId ?? ""} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm">
              <option value="">Create new conversation</option>
              {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
            </select>
            <EventChecklist name="eventIds" events={allEvents} selectedIds={[event.id, ...allEvents.filter((item) => item.conversationId && item.conversationId === event.conversationId).map((item) => item.id)]} compact />
            <Button type="submit" variant="secondary" size="sm"><GitBranch className="h-4 w-4" /> Group conversation</Button>
          </form>
        </div>
      </Section>
      <Section title="Linked events">
        <div className="space-y-2">
          {linked.map(({ relationship, other }) => (
            <div key={relationship.id} className="rounded-md border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <label className="flex items-center gap-2 text-xs text-sky-300">
                    <Link2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Relationship type</span>
                    <select
                      value={relationship.relationshipType}
                      onChange={(event) => onUpdateRelationship(relationship, event.target.value)}
                      className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-sky-100"
                    >
                      {[...new Set([relationship.relationshipType, ...eventRelationshipTypes])].map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </label>
                  <div className="mt-2 truncate text-sm">{other?.title ?? "Unknown event"}</div>
                </div>
                <Button type="button" size="icon" variant="ghost" title="Delete relationship" onClick={() => onDeleteRelationship(relationship)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function AnalyticsPanel({ events, analytics }: { events: EventItem[]; analytics: ReturnType<typeof calculateAnalytics> }) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center gap-3"><Activity className="h-5 w-5 text-sky-300" /><div><h2 className="font-semibold">Investigation analytics</h2><p className="text-sm text-slate-400">Response times, unanswered communications, gaps, and activity distribution.</p></div></div>
      <div className="grid grid-cols-4 gap-3"><Metric label="Average response hrs" value={analytics.averageResponse} /><Metric label="Longest response hrs" value={analytics.longestResponse} /><Metric label="Unanswered" value={analytics.unanswered.length} /><Metric label="Events analysed" value={events.length} /></div>
      <div className="mt-6 grid grid-cols-2 gap-5"><Panel title="Events per category"><Breakdown values={analytics.categoryCounts} /></Panel><Panel title="Events per person"><Breakdown values={analytics.peopleCounts} /></Panel></div>
      <Panel title="Communication gaps">{analytics.longestGap ? <p className="text-sm text-slate-300">Longest period of inactivity was {formatDistanceStrict(0, analytics.longestGap.hours * 60 * 60 * 1000)} between <span className="font-medium">{analytics.longestGap.from.title}</span> and <span className="font-medium">{analytics.longestGap.to.title}</span>.</p> : <p className="text-sm text-slate-400">No gaps detected.</p>}</Panel>
      <Panel title="Unanswered communications"><div className="space-y-2">{analytics.unanswered.slice(0, 10).map((event) => <div key={event.id} className="rounded-md bg-slate-950 p-3"><div className="font-medium">{event.title}</div><div className="text-xs text-slate-500">{format(dateOf(event.startDate), "dd MMM yyyy")}</div></div>)}</div></Panel>
    </div>
  );
}

function DataSafety({ caseId, audit, backups, onBackup }: { caseId: string; audit: WorkspaceData["auditTrail"]; backups: WorkspaceData["backups"]; onBackup: () => void }) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Data safety</h2><p className="text-sm text-slate-400">Backups, export/import, audit trail, and soft deletion history.</p></div><div className="flex gap-2"><Button onClick={onBackup} size="sm"><DatabaseBackup className="h-4 w-4" /> Backup</Button><a href={`/api/cases/${caseId}/export`}><Button variant="secondary" size="sm"><Download className="h-4 w-4" /> Export</Button></a></div></div>
      <div className="grid grid-cols-2 gap-5"><Panel title="Backups"><div className="space-y-2">{backups.map((backup) => <div key={backup.id} className="rounded-md bg-slate-950 p-3"><div className="text-sm">{backup.path}</div><div className="text-xs text-slate-500">{format(dateOf(backup.createdAt), "dd MMM yyyy HH:mm")}</div></div>)}</div></Panel><Panel title="Restore Sherlock JSON"><ImportForm /></Panel></div>
      <Panel title="Audit trail"><div className="space-y-2">{audit.map((entry) => <div key={entry.id} className="rounded-md border border-slate-800 bg-slate-950 p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{entry.summary}</span><Badge className="bg-slate-800 text-slate-200">{entry.action}</Badge></div><div className="mt-1 text-xs text-slate-500">{entry.entityType} | {format(dateOf(entry.createdAt), "dd MMM yyyy HH:mm")}</div></div>)}</div></Panel>
    </div>
  );
}

function ImportForm() {
  const [message, setMessage] = useState("");
  async function importCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("file");
    if (!(file instanceof File)) return;
    const response = await fetch("/api/cases/import", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() });
    if (response.ok) {
      setMessage("Restore complete. Refresh to load restored data.");
      return;
    }
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    setMessage(result?.error || "Restore failed.");
  }
  return <form onSubmit={importCase} className="space-y-3"><p className="text-sm leading-6 text-slate-400">Restores a Sherlock case export JSON file. Use Investigation Import for emails, PDFs, MBOX, DOCX, and communication logs.</p><Input type="file" name="file" accept=".json,application/json" required /><Button type="submit" size="sm"><Upload className="h-4 w-4" /> Restore JSON</Button>{message && <p className="text-sm text-slate-400">{message}</p>}</form>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-5 rounded-md border border-slate-800 bg-slate-900 p-4"><h3 className="mb-3 text-sm font-semibold">{title}</h3>{children}</section>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-6"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>{children}</section>;
}

function Breakdown({ values }: { values: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(values));
  return <div className="space-y-3">{Object.entries(values).map(([label, value]) => <div key={label}><div className="mb-1 flex justify-between text-xs text-slate-400"><span>{label}</span><span>{value}</span></div><div className="h-2 rounded bg-slate-800"><div className="h-2 rounded bg-sky-400" style={{ width: `${(value / max) * 100}%` }} /></div></div>)}</div>;
}
