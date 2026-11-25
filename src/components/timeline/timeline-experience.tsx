"use client";

import {
  addDays,
  differenceInCalendarDays,
  differenceInHours,
  format,
  parseISO,
} from "date-fns";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import * as React from "react";
import {
  Activity,
  AlarmClock,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bookmark,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Crosshair,
  Eye,
  FileCheck2,
  Filter,
  Flame,
  Focus,
  GripVertical,
  Layers3,
  Link2,
  Mail,
  Map as MapIcon,
  Maximize2,
  MessageSquare,
  Minimize2,
  Network,
  PanelRight,
  Pin,
  Search,
  Settings2,
  Sparkles,
  Tag,
  Target,
  Users,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EVIDENCE_FILE_ACCEPT } from "@/lib/evidence-policy";
import { cn } from "@/lib/utils";
import type { ActionItem, EventItem, Relationship } from "@/lib/types";

export type TimelineScale = "hour" | "day" | "week" | "month" | "year";

type DensityPreference = "auto" | "compact" | "comfortable";
type ColourMode = "semantic" | "risk" | "people";
type LaneKey = "communication" | "meetings" | "attendance" | "milestones" | "evidence" | "actions" | "system" | "other";
type CardMode = "overview" | "medium" | "expanded";

type TimelineExperienceProps = {
  events: EventItem[];
  relationships: Relationship[];
  actions: ActionItem[];
  scale: TimelineScale;
  setScale: (scale: TimelineScale) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  savedFilter: string;
  setSavedFilter: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
};

type NormalizedEvent = EventItem & {
  lane: LaneKey;
  isAction?: boolean;
  relatedIds: string[];
  startMs: number;
  endMs: number;
};

type PackedItem = {
  id: string;
  type: "event" | "cluster";
  lane: LaneKey;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  startMs: number;
  endMs: number;
  event?: NormalizedEvent;
  events: NormalizedEvent[];
};

type PackedLane = {
  key: LaneKey;
  rows: number;
  height: number;
  top: number;
  count: number;
};

type ViewportState = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const scaleOptions: TimelineScale[] = ["hour", "day", "week", "month", "year"];
const storageKey = "sherlock.timeline.preferences.v2";
const defaultLaneSidebarWidth = 184;
const minLaneSidebarWidth = 148;
const maxLaneSidebarWidth = 340;
const timelineGutter = 36;
const rowGap = 8;
const laneGap = 14;
const laneChrome = 50;
const minLaneHeight = 104;
const overscan = 900;

const defaultLaneOrder: LaneKey[] = [
  "communication",
  "meetings",
  "attendance",
  "milestones",
  "evidence",
  "actions",
  "system",
  "other",
];

const laneMeta: Record<
  LaneKey,
  {
    label: string;
    short: string;
    icon: typeof Mail;
    tint: string;
    border: string;
    fill: string;
    text: string;
  }
> = {
  communication: {
    label: "Communication",
    short: "Comm",
    icon: Mail,
    tint: "#74a7d8",
    border: "border-blue-300/35",
    fill: "bg-blue-300/12",
    text: "text-blue-100",
  },
  meetings: {
    label: "Meetings",
    short: "Meet",
    icon: CalendarClock,
    tint: "#d6a15f",
    border: "border-orange-300/35",
    fill: "bg-orange-300/12",
    text: "text-orange-100",
  },
  attendance: {
    label: "Attendance",
    short: "Attend",
    icon: AlarmClock,
    tint: "#b69cdf",
    border: "border-purple-300/35",
    fill: "bg-purple-300/12",
    text: "text-purple-100",
  },
  milestones: {
    label: "Milestones",
    short: "Mile",
    icon: Target,
    tint: "#db8ba4",
    border: "border-rose-300/35",
    fill: "bg-rose-300/12",
    text: "text-rose-100",
  },
  evidence: {
    label: "Evidence",
    short: "Ev",
    icon: FileCheck2,
    tint: "#8dc9a3",
    border: "border-emerald-300/35",
    fill: "bg-emerald-300/12",
    text: "text-emerald-100",
  },
  actions: {
    label: "Actions",
    short: "Act",
    icon: CheckCircle2,
    tint: "#9bb7cc",
    border: "border-slate-300/35",
    fill: "bg-slate-300/12",
    text: "text-slate-100",
  },
  system: {
    label: "System",
    short: "Sys",
    icon: Activity,
    tint: "#94a3b8",
    border: "border-slate-400/30",
    fill: "bg-slate-400/10",
    text: "text-slate-100",
  },
  other: {
    label: "Other",
    short: "Other",
    icon: Sparkles,
    tint: "#9ca3af",
    border: "border-slate-400/30",
    fill: "bg-slate-400/10",
    text: "text-slate-100",
  },
};

const pxPerDayByScale: Record<TimelineScale, number> = {
  hour: 420,
  day: 132,
  week: 46,
  month: 14,
  year: 3.4,
};

const cardMetrics: Record<CardMode, { width: number; height: number; clusterWidth: number; threshold: number }> = {
  overview: { width: 64, height: 18, clusterWidth: 112, threshold: 5 },
  medium: { width: 190, height: 46, clusterWidth: 148, threshold: 8 },
  expanded: { width: 286, height: 86, clusterWidth: 174, threshold: 12 },
};

function dateOf(value: string | Date) {
  return typeof value === "string" ? parseISO(value) : value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function eventLane(event: EventItem): LaneKey {
  const text = `${event.eventType} ${event.category} ${event.title}`.toLowerCase();
  if (event.eventType === "action") return "actions";
  if (/email|message|communication|phone|letter|teams/.test(text)) return "communication";
  if (/meeting|one.?to.?one|hearing|call/.test(text)) return "meetings";
  if (/attendance|sickness|absence|occupational health|wellbeing|return/.test(text)) return "attendance";
  if (/milestone|decision|grievance|escalation|deadline/.test(text)) return "milestones";
  if (/evidence|document|policy|witness|statement|attachment/.test(text)) return "evidence";
  if (/system|audit|backup|import|export/.test(text)) return "system";
  return "other";
}

function EventGlyph({
  event,
  className,
  style,
}: {
  event: NormalizedEvent;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (event.isAction) return <CheckCircle2 className={className} style={style} />;
  const type = event.eventType.toLowerCase();
  if (/email/.test(type)) return <Mail className={className} style={style} />;
  if (/message|teams/.test(type)) return <MessageSquare className={className} style={style} />;
  if (/meeting|call/.test(type)) return <CalendarClock className={className} style={style} />;
  if (/evidence|policy|witness/.test(type)) return <FileCheck2 className={className} style={style} />;
  if (/milestone|decision/.test(type)) return <Target className={className} style={style} />;
  if (/attendance|sick|health/.test(type)) return <AlarmClock className={className} style={style} />;
  if (event.lane === "communication") return <Mail className={className} style={style} />;
  if (event.lane === "meetings") return <CalendarClock className={className} style={style} />;
  if (event.lane === "attendance") return <AlarmClock className={className} style={style} />;
  if (event.lane === "milestones") return <Target className={className} style={style} />;
  if (event.lane === "evidence") return <FileCheck2 className={className} style={style} />;
  if (event.lane === "actions") return <CheckCircle2 className={className} style={style} />;
  if (event.lane === "system") return <Activity className={className} style={style} />;
  return <Sparkles className={className} style={style} />;
}

function importanceRank(value: string) {
  const key = value.toLowerCase();
  if (key === "critical") return 4;
  if (key === "high") return 3;
  if (key === "medium") return 2;
  return 1;
}

function itemColour(event: NormalizedEvent, mode: ColourMode) {
  if (mode === "risk") {
    const risk = importanceRank(event.importance);
    if (risk >= 4) return { tint: "#ff8f9d", border: "border-red-300/45", fill: "bg-red-300/14", text: "text-red-100" };
    if (risk === 3) return { tint: "#e0b26f", border: "border-amber-300/40", fill: "bg-amber-300/14", text: "text-amber-100" };
    return { tint: "#93a4b8", border: "border-slate-300/30", fill: "bg-slate-300/10", text: "text-slate-100" };
  }
  if (mode === "people" && event.people[0]) {
    const hue = hashCode(event.people[0].person.id) % 360;
    return {
      tint: `hsl(${hue} 52% 72%)`,
      border: "border-slate-300/35",
      fill: "bg-slate-300/10",
      text: "text-slate-100",
    };
  }
  return laneMeta[event.lane];
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function labelForCluster(events: NormalizedEvent[]) {
  const counts = events.reduce<Record<LaneKey, number>>((acc, event) => {
    acc[event.lane] = (acc[event.lane] ?? 0) + 1;
    return acc;
  }, {} as Record<LaneKey, number>);
  const [lane] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] as [LaneKey, number];
  return `+${events.length} ${laneMeta[lane].label}`;
}

function normaliseEvents(events: EventItem[], actions: ActionItem[], relationships: Relationship[]): NormalizedEvent[] {
  const related = relationships.reduce<Record<string, string[]>>((acc, relationship) => {
    acc[relationship.sourceId] = [...(acc[relationship.sourceId] ?? []), relationship.targetId];
    acc[relationship.targetId] = [...(acc[relationship.targetId] ?? []), relationship.sourceId];
    return acc;
  }, {});

  const actionEvents = actions.map<EventItem>((action) => ({
    id: `action-${action.id}`,
    caseId: action.caseId,
    title: action.title,
    description: action.description,
    notes: "",
    eventType: "action",
    category: action.status,
    importance: dateOf(action.dueDate) < new Date() && !["Completed", "Cancelled"].includes(action.status) ? "high" : "medium",
    status: action.status,
    startDate: action.dueDate,
    createdAt: action.createdAt,
    people: action.owner ? [{ person: action.owner, role: "Owner" }] : [],
    documents: action.evidence ? [{ document: action.evidence }] : [],
    tags: [],
  }));

  return [...events, ...actionEvents]
    .map((event) => {
      const start = dateOf(event.startDate).getTime();
      const explicitEnd = event.endDate ? dateOf(event.endDate).getTime() : start;
      return {
        ...event,
        lane: eventLane(event),
        isAction: event.id.startsWith("action-"),
        relatedIds: related[event.id] ?? [],
        startMs: start,
        endMs: Math.max(start, explicitEnd),
      };
    })
    .sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));
}

function filterEvents(events: NormalizedEvent[], query: string, savedFilter: string) {
  const queryText = query.trim().toLowerCase();
  return events.filter((event) => {
    const laneMatch = !savedFilter || event.lane === savedFilter || event.category === savedFilter;
    if (!laneMatch) return false;
    if (!queryText) return true;
    const text = [
      event.title,
      event.description,
      event.notes,
      event.eventType,
      event.category,
      event.status,
      event.people.map((item) => item.person.name).join(" "),
      event.documents.map((item) => item.document.title || item.document.filename).join(" "),
      event.tags.map((item) => item.tag.name).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(queryText);
  });
}

function cardModeFor(pxPerDay: number, density: DensityPreference): CardMode {
  if (density === "compact") return pxPerDay >= 90 ? "medium" : "overview";
  if (density === "comfortable") return pxPerDay >= 54 ? "expanded" : "medium";
  if (pxPerDay < 34) return "overview";
  if (pxPerDay < 104) return "medium";
  return "expanded";
}

function clusterWindowMs(mode: CardMode, pxPerDay: number) {
  if (mode === "overview") return 24 * 60 * 60 * 1000;
  if (mode === "medium") return pxPerDay < 72 ? 12 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
  return 2 * 60 * 60 * 1000;
}

function buildPackedLayout({
  events,
  laneOrder,
  collapsed,
  laneHeights,
  startMs,
  pixelsPerMs,
  mode,
  expandedClusterId,
}: {
  events: NormalizedEvent[];
  laneOrder: LaneKey[];
  collapsed: Record<string, boolean>;
  laneHeights: Record<string, number>;
  startMs: number;
  pixelsPerMs: number;
  mode: CardMode;
  expandedClusterId: string | null;
}) {
  const metrics = cardMetrics[mode];
  const packed: PackedItem[] = [];
  const lanes: PackedLane[] = [];
  let yCursor = 18;

  for (const lane of laneOrder) {
    const laneEvents = events.filter((event) => event.lane === lane);
    if (!laneEvents.length) continue;

    if (collapsed[lane]) {
      lanes.push({ key: lane, rows: 0, height: 44, top: yCursor, count: laneEvents.length });
      yCursor += 44 + laneGap;
      continue;
    }

    const buckets = new Map<string, NormalizedEvent[]>();
    const windowMs = clusterWindowMs(mode, 1 / pixelsPerMs / 86_400_000);
    for (const event of laneEvents) {
      const bucketId = `${lane}-${Math.floor(event.startMs / windowMs)}`;
      buckets.set(bucketId, [...(buckets.get(bucketId) ?? []), event]);
    }

    const layoutItems: Array<{ id: string; type: "event" | "cluster"; events: NormalizedEvent[]; startMs: number; endMs: number }> = [];
    for (const [bucketId, bucketEvents] of buckets) {
      const threshold = metrics.threshold;
      if (bucketEvents.length >= threshold && expandedClusterId !== bucketId) {
        layoutItems.push({
          id: bucketId,
          type: "cluster",
          events: bucketEvents,
          startMs: bucketEvents[0].startMs,
          endMs: bucketEvents.at(-1)?.endMs ?? bucketEvents[0].startMs,
        });
      } else if (expandedClusterId === bucketId && bucketEvents.length > 1) {
        bucketEvents.forEach((event, index) => {
          layoutItems.push({
            id: `${event.id}-fan-${index}`,
            type: "event",
            events: [event],
            startMs: event.startMs + index * 10,
            endMs: event.endMs + index * 10,
          });
        });
      } else {
        bucketEvents.forEach((event) => layoutItems.push({ id: event.id, type: "event", events: [event], startMs: event.startMs, endMs: event.endMs }));
      }
    }

    const rows: number[] = [];
    const sorted = layoutItems.sort((a, b) => a.startMs - b.startMs);
    for (const item of sorted) {
      const x = timelineGutter + (item.startMs - startMs) * pixelsPerMs;
      const baseWidth = item.type === "cluster" ? metrics.clusterWidth : metrics.width;
      const durationWidth = Math.max(baseWidth, (Math.max(item.endMs, item.startMs) - item.startMs) * pixelsPerMs);
      const width = clamp(durationWidth, item.type === "cluster" ? metrics.clusterWidth : metrics.width, mode === "expanded" ? 460 : 320);
      const row = rows.findIndex((lastRight) => x >= lastRight + 10);
      const rowIndex = row === -1 ? rows.length : row;
      rows[rowIndex] = x + width;
      packed.push({
        id: item.id,
        type: item.type,
        lane,
        row: rowIndex,
        x,
        y: yCursor + laneChrome + rowIndex * (metrics.height + rowGap),
        width,
        height: metrics.height,
        startMs: item.startMs,
        endMs: item.endMs,
        event: item.events[0],
        events: item.events,
      });
    }

    const naturalHeight = laneChrome + Math.max(1, rows.length) * (metrics.height + rowGap) + 12;
    const height = Math.max(minLaneHeight, laneHeights[lane] ?? naturalHeight, naturalHeight);
    lanes.push({ key: lane, rows: rows.length, height, top: yCursor, count: laneEvents.length });
    yCursor += height + laneGap;
  }

  return { packed, lanes, height: yCursor + 24 };
}

function useTimelinePreferences() {
  const [initialPreferences] = useState(readTimelinePreferences);
  const [laneOrder, setLaneOrder] = useState<LaneKey[]>(initialPreferences.laneOrder);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(initialPreferences.collapsed);
  const [laneHeights, setLaneHeights] = useState<Record<string, number>>(initialPreferences.laneHeights);
  const [laneSidebarWidth, setLaneSidebarWidth] = useState(initialPreferences.laneSidebarWidth);
  const [bookmarks, setBookmarks] = useState<number[]>(initialPreferences.bookmarks);
  const [pins, setPins] = useState<string[]>(initialPreferences.pins);
  const [markers, setMarkers] = useState<number[]>(initialPreferences.markers);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ laneOrder, collapsed, laneHeights, laneSidebarWidth, bookmarks, pins, markers }));
  }, [bookmarks, collapsed, laneHeights, laneOrder, laneSidebarWidth, markers, pins]);

  return {
    laneOrder,
    setLaneOrder,
    collapsed,
    setCollapsed,
    laneHeights,
    setLaneHeights,
    laneSidebarWidth,
    setLaneSidebarWidth,
    bookmarks,
    setBookmarks,
    pins,
    setPins,
    markers,
    setMarkers,
  };
}

function readTimelinePreferences() {
  const fallback = {
    laneOrder: defaultLaneOrder,
    collapsed: {} as Record<string, boolean>,
    laneHeights: {} as Record<string, number>,
    laneSidebarWidth: defaultLaneSidebarWidth,
    bookmarks: [] as number[],
    pins: [] as string[],
    markers: [] as number[],
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback>;
    return {
      laneOrder: parsed.laneOrder?.length
        ? [...parsed.laneOrder, ...defaultLaneOrder.filter((lane) => !parsed.laneOrder?.includes(lane))]
        : defaultLaneOrder,
      collapsed: parsed.collapsed ?? {},
      laneHeights: parsed.laneHeights ?? {},
      laneSidebarWidth: clamp(parsed.laneSidebarWidth ?? defaultLaneSidebarWidth, minLaneSidebarWidth, maxLaneSidebarWidth),
      bookmarks: parsed.bookmarks ?? [],
      pins: parsed.pins ?? [],
      markers: parsed.markers ?? [],
    };
  } catch {
    window.localStorage.removeItem(storageKey);
    return fallback;
  }
}

export function TimelineExperience({
  events,
  relationships,
  actions,
  scale,
  setScale,
  selectedId,
  onSelect,
  savedFilter,
  setSavedFilter,
  query,
  setQuery,
}: TimelineExperienceProps) {
  const reducedMotion = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const [zoom, setZoom] = useState(1);
  const [density, setDensity] = useState<DensityPreference>("auto");
  const [colourMode, setColourMode] = useState<ColourMode>("semantic");
  const [relationshipMode, setRelationshipMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ item: PackedItem; x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({ left: 0, top: 0, width: 1200, height: 720 });
  const [draggedLane, setDraggedLane] = useState<LaneKey | null>(null);
  const [nowMs] = useState(() => Date.now());
  const {
    laneOrder,
    setLaneOrder,
    collapsed,
    setCollapsed,
    laneHeights,
    setLaneHeights,
    laneSidebarWidth,
    setLaneSidebarWidth,
    bookmarks,
    setBookmarks,
    pins,
    setPins,
    markers,
    setMarkers,
  } = useTimelinePreferences();

  const normalized = useMemo(() => normaliseEvents(events, actions, relationships), [actions, events, relationships]);
  const filtered = useMemo(() => filterEvents(normalized, query, savedFilter), [normalized, query, savedFilter]);
  const firstMs = filtered[0]?.startMs ?? nowMs;
  const lastMs = filtered.at(-1)?.endMs ?? firstMs + 86_400_000;
  const startMs = addDays(new Date(firstMs), -1).getTime();
  const endMs = addDays(new Date(lastMs), 2).getTime();
  const rangeDays = Math.max(1, (endMs - startMs) / 86_400_000);
  const pxPerDay = pxPerDayByScale[scale] * zoom;
  const pixelsPerMs = pxPerDay / 86_400_000;
  const mode = cardModeFor(pxPerDay, density);
  const timelineWidth = Math.max(1200, Math.min(8_000_000, rangeDays * pxPerDay + timelineGutter * 2));
  const { packed, lanes, height } = useMemo(
    () =>
      buildPackedLayout({
        events: filtered,
        laneOrder,
        collapsed,
        laneHeights,
        startMs,
        pixelsPerMs,
        mode,
        expandedClusterId,
      }),
    [collapsed, expandedClusterId, filtered, laneHeights, laneOrder, mode, pixelsPerMs, startMs],
  );

  const selectedItem = packed.find((item) => item.event?.id === selectedId || item.events.some((event) => event.id === selectedId));
  const hoveredItem = packed.find((item) => item.id === hoveredId || item.event?.id === hoveredId);
  const activeEvent = selectedItem?.event ?? hoveredItem?.event;
  const activeRelatedIds = new Set(activeEvent ? [activeEvent.id, ...activeEvent.relatedIds] : []);
  const activePeople = new Set(activeEvent?.people.map((item) => item.person.id) ?? []);
  const activeEvidence = new Set(activeEvent?.documents.map((item) => item.document.id) ?? []);
  const contentViewportLeft = Math.max(0, viewport.left - laneSidebarWidth);
  const visibleItems = packed.filter(
    (item) =>
      item.x + item.width > contentViewportLeft - overscan &&
      item.x < contentViewportLeft + viewport.width + overscan &&
      item.y + item.height > viewport.top - 260 &&
      item.y < viewport.top + viewport.height + 260,
  );
  const ticks = useMemo(() => {
    const count = scale === "hour" ? 14 : 10;
    return Array.from({ length: count }, (_, index) => {
      const ms = startMs + ((endMs - startMs) / (count - 1)) * index;
      return new Date(ms);
    });
  }, [endMs, scale, startMs]);
  const activityDays = useMemo(() => {
    const counts = new Map<number, number>();
    filtered.forEach((event) => {
      const date = new Date(event.startMs);
      const key = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [filtered]);
  const maxDayActivity = Math.max(1, ...activityDays.values());

  const updateViewport = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    setViewport({ left: node.scrollLeft, top: node.scrollTop, width: node.clientWidth, height: node.clientHeight });
  }, []);

  useEffect(() => {
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, [updateViewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scroller = scrollerRef.current;
    if (!canvas || !scroller) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(dpr, dpr);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = "#020617";
    context.fillRect(0, 0, rect.width, rect.height);
    lanes.forEach((lane, index) => {
      const y = 8 + index * ((rect.height - 16) / Math.max(1, lanes.length));
      context.fillStyle = "rgba(148, 163, 184, 0.11)";
      context.fillRect(8, y, rect.width - 16, 1);
      context.fillStyle = laneMeta[lane.key].tint;
      packed
        .filter((item) => item.lane === lane.key)
        .forEach((item) => {
          const x = 8 + (item.x / timelineWidth) * (rect.width - 16);
          const width = Math.max(1.5, (item.width / timelineWidth) * (rect.width - 16));
          context.globalAlpha = item.type === "cluster" ? 0.42 : 0.72;
          context.fillRect(x, y - 2, width, 4);
        });
    });
    context.globalAlpha = 1;
    context.strokeStyle = "#22d3ee";
    context.lineWidth = 1.5;
    context.strokeRect(
      8 + (contentViewportLeft / timelineWidth) * (rect.width - 16),
      4,
      Math.max(12, (viewport.width / timelineWidth) * (rect.width - 16)),
      rect.height - 8,
    );
  }, [contentViewportLeft, lanes, packed, timelineWidth, viewport.width]);

  function zoomBy(delta: number, anchor?: number) {
    const node = scrollerRef.current;
    const previousPxPerDay = pxPerDay;
    const nextZoom = clamp(zoom + delta, 0.3, 6);
    setZoom(nextZoom);
    if (node && anchor !== undefined) {
      const anchorRatio = (node.scrollLeft + anchor - laneSidebarWidth) / previousPxPerDay;
      requestAnimationFrame(() => {
        node.scrollLeft = anchorRatio * pxPerDayByScale[scale] * nextZoom - anchor + laneSidebarWidth;
        updateViewport();
      });
    }
  }

  function jumpTo(ms: number) {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({
      left: Math.max(0, timelineGutter + (ms - startMs) * pixelsPerMs - node.clientWidth * 0.45),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }

  function fitTimeline() {
    const scaleByRange: TimelineScale = rangeDays > 900 ? "year" : rangeDays > 120 ? "month" : rangeDays > 42 ? "week" : "day";
    setScale(scaleByRange);
    setZoom(1);
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ left: 0, top: 0, behavior: reducedMotion ? "auto" : "smooth" });
      updateViewport();
    });
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.shiftKey) {
      event.preventDefault();
      event.currentTarget.scrollLeft += event.deltaY + event.deltaX;
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomBy(event.deltaY > 0 ? -0.08 : 0.08, event.clientX - event.currentTarget.getBoundingClientRect().left);
    }
  }

  function resizeLaneSidebar(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = laneSidebarWidth;

    function move(pointerEvent: PointerEvent) {
      setLaneSidebarWidth(clamp(startWidth + pointerEvent.clientX - startX, minLaneSidebarWidth, maxLaneSidebarWidth));
    }

    function stop() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,a,input,select,textarea,[data-timeline-resize]")) return;
    const node = scrollerRef.current;
    if (!node) return;
    isPanningRef.current = true;
    panStartRef.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
    node.setPointerCapture(event.pointerId);
    node.classList.add("cursor-grabbing");
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isPanningRef.current) return;
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollLeft = panStartRef.current.left - (event.clientX - panStartRef.current.x);
    node.scrollTop = panStartRef.current.top - (event.clientY - panStartRef.current.y);
  }

  function stopPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    event.currentTarget.classList.remove("cursor-grabbing");
  }

  function reorderLane(target: LaneKey) {
    if (!draggedLane || draggedLane === target) return;
    setLaneOrder((current) => {
      const next = current.filter((lane) => lane !== draggedLane);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex, 0, draggedLane);
      return next;
    });
  }

  function resizeLane(lane: LaneKey, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const currentLane = lanes.find((item) => item.key === lane);
    const startHeight = currentLane?.height ?? minLaneHeight;

    function move(pointerEvent: PointerEvent) {
      const next = clamp(startHeight + pointerEvent.clientY - startY, 80, 420);
      setLaneHeights((current) => ({ ...current, [lane]: next }));
    }

    function stop() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const sortedEvents = filtered.filter((item) => !item.isAction);
    const selectedIndex = sortedEvents.findIndex((item) => item.id === selectedId);
    if (event.key === "=" || event.key === "+") {
      event.preventDefault();
      zoomBy(0.16, viewport.width / 2);
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomBy(-0.16, viewport.width / 2);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = sortedEvents[Math.min(sortedEvents.length - 1, selectedIndex + 1)] ?? sortedEvents[0];
      if (next) {
        onSelect(next.id);
        jumpTo(next.startMs);
      }
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = sortedEvents[Math.max(0, selectedIndex - 1)] ?? sortedEvents[0];
      if (next) {
        onSelect(next.id);
        jumpTo(next.startMs);
      }
    }
    if (event.key.toLowerCase() === "b" && activeEvent) {
      setBookmarks((current) => [...current, activeEvent.startMs]);
    }
    if (event.key.toLowerCase() === "p" && activeEvent && !activeEvent.isAction) {
      setPins((current) => (current.includes(activeEvent.id) ? current.filter((id) => id !== activeEvent.id) : [...current, activeEvent.id]));
    }
  }

  const metrics = {
    total: filtered.length,
    pinned: pins.length,
    relationships: relationships.length,
    range: differenceInCalendarDays(new Date(endMs), new Date(startMs)),
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#040812] text-slate-100">
      <TimelineToolbar
        query={query}
        setQuery={setQuery}
        savedFilter={savedFilter}
        setSavedFilter={setSavedFilter}
        scale={scale}
        setScale={setScale}
        density={density}
        setDensity={setDensity}
        colourMode={colourMode}
        setColourMode={setColourMode}
        relationshipMode={relationshipMode}
        setRelationshipMode={setRelationshipMode}
        focusMode={focusMode}
        setFocusMode={setFocusMode}
        metrics={metrics}
        onFit={fitTimeline}
        onToday={() => jumpTo(Date.now())}
        onDatePick={(date) => jumpTo(new Date(`${date}T12:00:00`).getTime())}
        onStart={() => jumpTo(firstMs)}
        onLatest={() => jumpTo(lastMs)}
        onZoomIn={() => zoomBy(0.18, viewport.width / 2)}
        onZoomOut={() => zoomBy(-0.18, viewport.width / 2)}
        onBookmark={() => setBookmarks((current) => [...current, activeEvent?.startMs ?? Date.now()])}
        onMarker={() => setMarkers((current) => [...current, activeEvent?.startMs ?? Date.now()])}
      />

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_72px]">
        <div
          ref={scrollerRef}
          role="application"
          aria-label="Investigation timeline"
          tabIndex={0}
          className="relative min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onScroll={updateViewport}
          onWheel={handleWheel}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={stopPan}
          onPointerCancel={stopPan}
          onDoubleClick={(event) => zoomBy(0.3, event.clientX - event.currentTarget.getBoundingClientRect().left)}
          onKeyDown={handleKeyDown}
        >
          <div className="sticky left-0 top-0 z-40 h-11 border-b border-slate-800/80 bg-[#050914]/95 backdrop-blur" style={{ width: laneSidebarWidth }}>
            <div className="flex h-full items-center gap-2 px-3 text-[12px] font-medium text-slate-400">
              <Layers3 className="h-3.5 w-3.5" />
              Lanes
            </div>
            <LaneSidebarResizeHandle onPointerDown={resizeLaneSidebar} />
          </div>
          <div className="relative" style={{ width: timelineWidth + laneSidebarWidth, height: Math.max(height, viewport.height + 120) }}>
            <TimelineGrid
              laneSidebarWidth={laneSidebarWidth}
              ticks={ticks}
              startMs={startMs}
              pixelsPerMs={pixelsPerMs}
              timelineWidth={timelineWidth}
              height={height}
              activityDays={activityDays}
              maxDayActivity={maxDayActivity}
              bookmarks={bookmarks}
              markers={markers}
            />
            <div className="absolute left-0 top-0 z-30 h-full border-r border-slate-800/80 bg-[#050914]/92 backdrop-blur" style={{ width: laneSidebarWidth }}>
              <div className="h-11 border-b border-slate-800/80" />
              <LaneSidebarResizeHandle onPointerDown={resizeLaneSidebar} />
              {lanes.map((lane) => (
                <TimelineLaneHeader
                  key={lane.key}
                  lane={lane}
                  collapsed={Boolean(collapsed[lane.key])}
                  draggedLane={draggedLane}
                  onCollapse={() => setCollapsed((current) => ({ ...current, [lane.key]: !current[lane.key] }))}
                  onDragStart={() => setDraggedLane(lane.key)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    reorderLane(lane.key);
                  }}
                  onDragEnd={() => setDraggedLane(null)}
                  onResize={(event) => resizeLane(lane.key, event)}
                />
              ))}
            </div>

            <svg
              className={cn("pointer-events-none absolute top-0 z-10 transition-opacity", relationshipMode || activeEvent ? "opacity-100" : "opacity-0")}
              style={{ left: laneSidebarWidth }}
              width={timelineWidth}
              height={height}
              aria-hidden
            >
              <TimelineRelationships
                packed={packed}
                relationships={relationships}
                activeEvent={activeEvent}
                relationshipMode={relationshipMode}
              />
            </svg>

            <AnimatePresence initial={false}>
              {visibleItems.map((item) => {
                const isSelected = item.events.some((event) => event.id === selectedId);
                const isHovered = item.id === hoveredId || item.event?.id === hoveredId;
                const isRelated =
                  !activeEvent ||
                  item.events.some(
                    (event) =>
                      activeRelatedIds.has(event.id) ||
                      event.people.some((person) => activePeople.has(person.person.id)) ||
                      event.documents.some((doc) => activeEvidence.has(doc.document.id)),
                  );
                const inactive = focusMode && !isSelected && !isHovered && !isRelated;
                return item.type === "cluster" ? (
                  <TimelineCluster
                    key={item.id}
                    item={item}
                    laneSidebarWidth={laneSidebarWidth}
                    mode={mode}
                    selected={isSelected}
                    inactive={inactive}
                    onExpand={() => setExpandedClusterId(expandedClusterId === item.id ? null : item.id)}
                    onHover={(x, y) => {
                      setHoveredId(item.id);
                      setPreview({ item, x, y });
                    }}
                    onLeave={() => {
                      setHoveredId(null);
                      setPreview(null);
                    }}
                  />
                ) : (
                  <TimelineEvent
                    key={item.id}
                    item={item}
                    laneSidebarWidth={laneSidebarWidth}
                    mode={mode}
                    colourMode={colourMode}
                    selected={isSelected}
                    hovered={isHovered}
                    related={isRelated}
                    inactive={inactive}
                    pinned={Boolean(item.event && pins.includes(item.event.id))}
                    onSelect={() => {
                      if (item.event && !item.event.isAction) onSelect(item.event.id);
                    }}
                    onPin={() => {
                      if (!item.event || item.event.isAction) return;
                      setPins((current) => (current.includes(item.event!.id) ? current.filter((id) => id !== item.event!.id) : [...current, item.event!.id]));
                    }}
                    onHover={(x, y) => {
                      setHoveredId(item.event?.id ?? item.id);
                      setPreview({ item, x, y });
                    }}
                    onLeave={() => {
                      setHoveredId(null);
                      setPreview(null);
                    }}
                  />
                );
              })}
            </AnimatePresence>

            <AnimatePresence>{preview && <TimelineTooltip key={preview.item.id} preview={preview} />}</AnimatePresence>
          </div>
        </div>
        <TimelineMinimap
          ref={canvasRef}
          startLabel={format(new Date(startMs), "dd MMM yyyy")}
          endLabel={format(new Date(endMs), "dd MMM yyyy")}
          onJump={(ratio) => {
            const node = scrollerRef.current;
            if (!node) return;
            node.scrollTo({ left: ratio * timelineWidth - node.clientWidth / 2, behavior: reducedMotion ? "auto" : "smooth" });
          }}
        />
      </div>
    </div>
  );
}

function TimelineToolbar({
  query,
  setQuery,
  savedFilter,
  setSavedFilter,
  scale,
  setScale,
  density,
  setDensity,
  colourMode,
  setColourMode,
  relationshipMode,
  setRelationshipMode,
  focusMode,
  setFocusMode,
  metrics,
  onFit,
  onToday,
  onDatePick,
  onStart,
  onLatest,
  onZoomIn,
  onZoomOut,
  onBookmark,
  onMarker,
}: {
  query: string;
  setQuery: (value: string) => void;
  savedFilter: string;
  setSavedFilter: (value: string) => void;
  scale: TimelineScale;
  setScale: (scale: TimelineScale) => void;
  density: DensityPreference;
  setDensity: (value: DensityPreference) => void;
  colourMode: ColourMode;
  setColourMode: (value: ColourMode) => void;
  relationshipMode: boolean;
  setRelationshipMode: (value: boolean) => void;
  focusMode: boolean;
  setFocusMode: (value: boolean) => void;
  metrics: { total: number; pinned: number; relationships: number; range: number };
  onFit: () => void;
  onToday: () => void;
  onDatePick: (date: string) => void;
  onStart: () => void;
  onLatest: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onBookmark: () => void;
  onMarker: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-slate-800/80 bg-[#050914]/95 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative w-[min(24vw,280px)] min-w-44">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search timeline"
            className="h-9 rounded border-slate-800 bg-slate-950/80 pl-8 text-[13px]"
          />
        </div>
        <ToolbarSelect icon={Filter} label="Filter" value={savedFilter} onChange={setSavedFilter}>
          <option value="">All</option>
          {defaultLaneOrder.map((lane) => (
            <option key={lane} value={lane}>
              {laneMeta[lane].label}
            </option>
          ))}
        </ToolbarSelect>
        <Chip icon={Users} label="People" />
        <Chip icon={FileCheck2} label="Evidence" />
        <Chip icon={Flame} label="Risk" />
        <Chip icon={AlarmClock} label="Attendance" />
        <Chip icon={Mail} label="Communication" />
        <input
          aria-label="Jump to date"
          type="date"
          onChange={(event) => {
            if (event.target.value) onDatePick(event.target.value);
          }}
          className="h-9 w-[132px] rounded border border-slate-800 bg-slate-950/80 px-2 text-[12px] text-slate-300 outline-none focus:border-cyan-300"
        />
        <div className="flex rounded border border-slate-800 bg-slate-950/80 p-0.5">
          {scaleOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setScale(option)}
              className={cn(
                "h-7 rounded px-2 text-[11px] font-semibold uppercase text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                scale === option && "bg-cyan-300 text-slate-950",
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <IconButton label="Zoom out" icon={ZoomOut} onClick={onZoomOut} />
        <IconButton label="Zoom in" icon={ZoomIn} onClick={onZoomIn} />
        <IconButton label="Fit timeline" icon={Maximize2} onClick={onFit} />
        <IconButton label="Today" icon={Crosshair} onClick={onToday} />
        <ToolbarSelect icon={Layers3} label="Density" value={density} onChange={(value) => setDensity(value as DensityPreference)}>
          <option value="auto">Auto</option>
          <option value="compact">Compact</option>
          <option value="comfortable">Expanded</option>
        </ToolbarSelect>
        <ToolbarSelect icon={Settings2} label="Colour mode" value={colourMode} onChange={(value) => setColourMode(value as ColourMode)}>
          <option value="semantic">Semantic</option>
          <option value="risk">Risk</option>
          <option value="people">People</option>
        </ToolbarSelect>
        <IconButton label="Saved views" icon={Eye} onClick={onFit} />
        <IconButton label="Relationships" icon={Network} active={relationshipMode} onClick={() => setRelationshipMode(!relationshipMode)} />
        <IconButton label="Focus mode" icon={Focus} active={focusMode} onClick={() => setFocusMode(!focusMode)} />
        <IconButton label="Bookmark date" icon={Bookmark} onClick={onBookmark} />
        <IconButton label="Annotate date" icon={Pin} onClick={onMarker} />
        <IconButton label="Investigation start" icon={ChevronsLeft} onClick={onStart} />
        <IconButton label="Latest activity" icon={ChevronsRight} onClick={onLatest} />
        <div className="ml-auto hidden shrink-0 items-center gap-3 text-[12px] text-slate-500 2xl:flex">
          <span className="font-mono text-slate-300">{metrics.total}</span>
          <span>events</span>
          <span className="font-mono text-slate-300">{metrics.relationships}</span>
          <span>links</span>
          <span className="font-mono text-slate-300">{metrics.range}</span>
          <span>days</span>
        </div>
      </div>
    </div>
  );
}

function ToolbarSelect({
  icon: Icon,
  label,
  value,
  onChange,
  children,
}: {
  icon: typeof Search;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative inline-flex h-9 shrink-0 items-center rounded border border-slate-800 bg-slate-950/80 text-[12px] text-slate-300">
      <Icon className="ml-2 h-3.5 w-3.5 text-slate-500" />
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full appearance-none bg-transparent px-2 pr-6 outline-none"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-slate-500" />
    </label>
  );
}

function Chip({ icon: Icon, label }: { icon: typeof Search; label: string }) {
  return (
    <button
      type="button"
      className="hidden h-9 shrink-0 items-center gap-1.5 rounded border border-slate-800 bg-slate-950/65 px-2.5 text-[12px] text-slate-400 outline-none hover:border-slate-700 hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-cyan-300 xl:inline-flex"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  active = false,
}: {
  label: string;
  icon: typeof Search;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-slate-800 bg-slate-950/80 text-slate-400 outline-none hover:border-slate-700 hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-cyan-300",
        active && "border-cyan-300/70 bg-cyan-300/15 text-cyan-100",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function LaneSidebarResizeHandle({ onPointerDown }: { onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
  return (
    <div
      data-timeline-resize
      role="separator"
      aria-label="Resize lane category column"
      title="Drag to resize lane category column"
      tabIndex={0}
      onPointerDown={onPointerDown}
      className="group absolute right-0 top-0 z-50 flex h-full w-2 cursor-col-resize items-stretch justify-center outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
    >
      <div className="w-px bg-slate-700 transition-colors group-hover:bg-cyan-300" />
    </div>
  );
}

function TimelineGrid({
  laneSidebarWidth,
  ticks,
  startMs,
  pixelsPerMs,
  timelineWidth,
  height,
  activityDays,
  maxDayActivity,
  bookmarks,
  markers,
}: {
  laneSidebarWidth: number;
  ticks: Date[];
  startMs: number;
  pixelsPerMs: number;
  timelineWidth: number;
  height: number;
  activityDays: Map<number, number>;
  maxDayActivity: number;
  bookmarks: number[];
  markers: number[];
}) {
  return (
    <div className="absolute top-0" style={{ left: laneSidebarWidth, width: timelineWidth, height }}>
      <div className="sticky top-0 z-20 h-11 border-b border-slate-800/80 bg-[#050914]/88 backdrop-blur">
        {ticks.map((tick) => {
          const x = timelineGutter + (tick.getTime() - startMs) * pixelsPerMs;
          return (
            <div key={tick.toISOString()} className="absolute top-0 h-full border-l border-slate-800/70" style={{ left: x }}>
              <div className="ml-2 mt-2 whitespace-nowrap font-mono text-[12px] text-slate-500">{format(tick, "dd MMM yyyy")}</div>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-11 h-[calc(100%-44px)]">
        {ticks.map((tick) => {
          const x = timelineGutter + (tick.getTime() - startMs) * pixelsPerMs;
          return <div key={tick.toISOString()} className="absolute top-0 h-full border-l border-dashed border-slate-800/45" style={{ left: x }} />;
        })}
        {Array.from(activityDays.entries()).map(([day, count]) => {
          const x = timelineGutter + (day - startMs) * pixelsPerMs;
          const width = Math.max(2, 86_400_000 * pixelsPerMs);
          const opacity = 0.05 + (count / maxDayActivity) * 0.14;
          return <div key={day} className="absolute top-0 h-full bg-cyan-200" style={{ left: x, width, opacity }} />;
        })}
        {bookmarks.map((date, index) => {
          const x = timelineGutter + (date - startMs) * pixelsPerMs;
          return (
            <div key={`${date}-${index}`} className="absolute top-0 h-full border-l border-cyan-300/55" style={{ left: x }}>
              <Bookmark className="ml-1 mt-2 h-3.5 w-3.5 text-cyan-200" />
            </div>
          );
        })}
        {markers.map((date, index) => {
          const x = timelineGutter + (date - startMs) * pixelsPerMs;
          return (
            <div key={`${date}-${index}`} className="absolute top-0 h-full border-l border-amber-300/55" style={{ left: x }}>
              <Pin className="ml-1 mt-7 h-3.5 w-3.5 text-amber-200" />
            </div>
          );
        })}
        <WeekendAndWorkingHours startMs={startMs} pixelsPerMs={pixelsPerMs} height={height} timelineWidth={timelineWidth} />
      </div>
    </div>
  );
}

function WeekendAndWorkingHours({
  startMs,
  pixelsPerMs,
  height,
  timelineWidth,
}: {
  startMs: number;
  pixelsPerMs: number;
  height: number;
  timelineWidth: number;
}) {
  const dayWidth = 86_400_000 * pixelsPerMs;
  if (dayWidth < 8) return null;
  const days = Math.ceil(timelineWidth / dayWidth);
  return (
    <>
      {Array.from({ length: Math.min(days, 1500) }, (_, index) => {
        const date = new Date(startMs + index * 86_400_000);
        const day = date.getDay();
        const left = timelineGutter + index * dayWidth;
        return (
          <div key={date.toISOString()} className="absolute top-0" style={{ left, width: dayWidth, height }}>
            {(day === 0 || day === 6) && <div className="h-full w-full bg-slate-400/[0.035]" />}
            {dayWidth > 64 && (
              <div className="absolute top-0 h-full bg-slate-50/[0.025]" style={{ left: dayWidth * (9 / 24), width: dayWidth * (8 / 24) }} />
            )}
          </div>
        );
      })}
    </>
  );
}

function TimelineLaneHeader({
  lane,
  collapsed,
  draggedLane,
  onCollapse,
  onDragStart,
  onDragOver,
  onDragEnd,
  onResize,
}: {
  lane: PackedLane;
  collapsed: boolean;
  draggedLane: LaneKey | null;
  onCollapse: () => void;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const meta = laneMeta[lane.key];
  const Icon = meta.icon;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn("absolute left-0 w-full border-b border-slate-800/60", draggedLane === lane.key && "opacity-50")}
      style={{ top: lane.top, height: lane.height }}
    >
      <div className="flex h-12 items-center gap-2 px-3">
        <GripVertical className="h-4 w-4 text-slate-600" />
        <button
          type="button"
          onClick={onCollapse}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left outline-none hover:bg-slate-800/70 focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-700/80 bg-slate-950" style={{ color: meta.tint }}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-slate-200">{meta.label}</span>
            <span className="block font-mono text-[11px] text-slate-500">
              {lane.count} events · {collapsed ? "collapsed" : `${lane.rows} rows`}
            </span>
          </span>
          {collapsed ? <ArrowRight className="ml-auto h-3.5 w-3.5 text-slate-500" /> : <ArrowDown className="ml-auto h-3.5 w-3.5 text-slate-500" />}
        </button>
      </div>
      <div className="absolute bottom-0 left-0 h-1 w-full cursor-row-resize" onPointerDown={onResize} />
    </div>
  );
}

function TimelineEvent({
  item,
  laneSidebarWidth,
  mode,
  colourMode,
  selected,
  hovered,
  related,
  inactive,
  pinned,
  onSelect,
  onPin,
  onHover,
  onLeave,
}: {
  item: PackedItem;
  laneSidebarWidth: number;
  mode: CardMode;
  colourMode: ColourMode;
  selected: boolean;
  hovered: boolean;
  related: boolean;
  inactive: boolean;
  pinned: boolean;
  onSelect: () => void;
  onPin: () => void;
  onHover: (x: number, y: number) => void;
  onLeave: () => void;
}) {
  const event = item.event!;
  const colour = itemColour(event, colourMode);
  const severity = importanceRank(event.importance);
  return (
    <motion.button
      type="button"
      role="option"
      aria-selected={selected}
      layout
      initial={{ opacity: 0, y: 5, scale: 0.98 }}
      animate={{
        opacity: inactive ? 0.22 : related ? 1 : 0.42,
        y: 0,
        scale: hovered || selected ? 1.01 : 1,
        boxShadow: selected
          ? "0 0 0 2px rgba(34, 211, 238, .95), 0 18px 40px rgba(0,0,0,.34)"
          : hovered
            ? "0 14px 32px rgba(0,0,0,.32)"
            : "0 8px 20px rgba(0,0,0,.18)",
      }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 430, damping: 36, mass: 0.8 }}
      onClick={onSelect}
      onMouseEnter={(eventPointer) => onHover(eventPointer.clientX, eventPointer.clientY)}
      onMouseMove={(eventPointer) => onHover(eventPointer.clientX, eventPointer.clientY)}
      onMouseLeave={onLeave}
      className={cn(
        "absolute z-20 overflow-hidden rounded-md border text-left outline-none backdrop-blur focus-visible:ring-2 focus-visible:ring-cyan-300",
        colour.border,
        colour.fill,
        colour.text,
        selected && "border-cyan-200",
      )}
      style={{
        left: laneSidebarWidth,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        borderColor: selected ? "#67e8f9" : undefined,
      }}
    >
      {mode === "overview" ? (
        <div className="flex h-full items-center gap-1.5 px-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour.tint }} />
          <EventGlyph event={event} className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono text-[11px] text-slate-300">{durationLabel(event)}</span>
        </div>
      ) : (
        <div className={cn("grid h-full gap-x-2 p-2", mode === "expanded" ? "grid-cols-[18px_1fr_auto]" : "grid-cols-[18px_1fr]")}>
          <EventGlyph event={event} className="mt-0.5 h-4 w-4" style={{ color: colour.tint }} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold leading-5 text-slate-100">{event.title}</div>
            <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[12px] text-slate-400">
              <Clock3 className="h-3 w-3 shrink-0" />
              {format(new Date(event.startMs), "dd MMM HH:mm")}
            </div>
            {mode === "expanded" && (
              <>
                <div className="mt-1 truncate text-[12px] text-slate-400">{event.description || event.category}</div>
                <div className="mt-1.5 flex min-w-0 gap-1">
                  {event.people.slice(0, 2).map((person) => (
                    <Badge key={person.person.id} className="max-w-24 truncate bg-slate-950/60 text-[11px] text-slate-300">
                      {person.person.name}
                    </Badge>
                  ))}
                  {event.tags.slice(0, 1).map((tag) => (
                    <Badge key={tag.tag.id} className="max-w-20 truncate bg-slate-950/60 text-[11px] text-slate-300">
                      {tag.tag.name}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </div>
          {mode === "expanded" && (
            <div className="flex flex-col items-end gap-1">
              {pinned && <Pin className="h-3.5 w-3.5 text-cyan-200" />}
              <button
                type="button"
                title={pinned ? "Unpin event" : "Pin event"}
                className="rounded p-1 text-slate-500 hover:bg-slate-950/70 hover:text-cyan-100"
                onClick={(eventPointer) => {
                  eventPointer.stopPropagation();
                  onPin();
                }}
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
              <span
                className={cn("h-2 w-2 rounded-full", severity >= 4 ? "bg-red-300" : severity === 3 ? "bg-amber-300" : "bg-slate-500")}
                title={event.importance}
              />
            </div>
          )}
        </div>
      )}
    </motion.button>
  );
}

function TimelineCluster({
  item,
  laneSidebarWidth,
  mode,
  selected,
  inactive,
  onExpand,
  onHover,
  onLeave,
}: {
  item: PackedItem;
  laneSidebarWidth: number;
  mode: CardMode;
  selected: boolean;
  inactive: boolean;
  onExpand: () => void;
  onHover: (x: number, y: number) => void;
  onLeave: () => void;
}) {
  const meta = laneMeta[item.lane];
  const Icon = meta.icon;
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{
        opacity: inactive ? 0.24 : 0.82,
        scale: selected ? 1.01 : 1,
        boxShadow: selected ? "0 0 0 2px rgba(34,211,238,.9), 0 14px 30px rgba(0,0,0,.32)" : "0 9px 20px rgba(0,0,0,.18)",
      }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      onClick={onExpand}
      onMouseEnter={(eventPointer) => onHover(eventPointer.clientX, eventPointer.clientY)}
      onMouseMove={(eventPointer) => onHover(eventPointer.clientX, eventPointer.clientY)}
      onMouseLeave={onLeave}
      className={cn(
        "absolute z-20 flex items-center gap-2 rounded-md border border-slate-600/40 bg-slate-900/90 px-2 text-left outline-none backdrop-blur hover:border-cyan-300/60 focus-visible:ring-2 focus-visible:ring-cyan-300",
        selected && "border-cyan-200",
      )}
      style={{ left: laneSidebarWidth, x: item.x, y: item.y, width: item.width, height: item.height }}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-950" style={{ color: meta.tint }}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-slate-100">{mode === "overview" ? `+${item.events.length}` : labelForCluster(item.events)}</span>
        {mode !== "overview" && <span className="block truncate font-mono text-[11px] text-slate-500">{format(new Date(item.startMs), "dd MMM HH:mm")}</span>}
      </span>
    </motion.button>
  );
}

function TimelineTooltip({ preview }: { preview: { item: PackedItem; x: number; y: number } }) {
  const primary = preview.item.event;
  const events = preview.item.events;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 520, damping: 36 }}
      className="pointer-events-none fixed z-50 max-w-[360px] rounded-md border border-slate-700 bg-[#080d18]/98 p-3 text-sm shadow-2xl backdrop-blur"
      style={{ left: Math.min(preview.x + 14, window.innerWidth - 380), top: Math.min(preview.y + 14, window.innerHeight - 260) }}
    >
      {preview.item.type === "cluster" ? (
        <>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            <Layers3 className="h-3.5 w-3.5" />
            {events.length} clustered events
          </div>
          <div className="space-y-1.5">
            {events.slice(0, 8).map((event) => (
              <div key={event.id} className="grid grid-cols-[74px_1fr] gap-2">
                <span className="font-mono text-[11px] text-slate-500">{format(new Date(event.startMs), "dd MMM HH:mm")}</span>
                <span className="truncate text-[12px] text-slate-200">{event.title}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        primary && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-slate-50">{primary.title}</div>
                <div className="mt-1 font-mono text-[12px] text-cyan-200">{format(new Date(primary.startMs), "dd MMM yyyy HH:mm")}</div>
              </div>
              <Badge className="bg-slate-800 text-slate-200">{primary.importance}</Badge>
            </div>
            <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-slate-400">{primary.description || primary.category}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {primary.people.slice(0, 3).map((person) => (
                <Badge key={person.person.id} className="bg-slate-900 text-slate-300">
                  {person.person.name}
                </Badge>
              ))}
              {primary.documents.slice(0, 2).map((document) => (
                <Badge key={document.document.id} className="bg-emerald-300/10 text-emerald-100">
                  {document.document.title || document.document.filename}
                </Badge>
              ))}
            </div>
          </>
        )
      )}
    </motion.div>
  );
}

function TimelineRelationships({
  packed,
  relationships,
  activeEvent,
  relationshipMode,
}: {
  packed: PackedItem[];
  relationships: Relationship[];
  activeEvent?: NormalizedEvent;
  relationshipMode: boolean;
}) {
  const positions = new Map<string, { x: number; y: number }>();
  packed.forEach((item) => {
    item.events.forEach((event) => {
      positions.set(event.id, { x: item.x + item.width / 2, y: item.y + item.height / 2 });
    });
  });
  const relatedIds = activeEvent ? new Set([activeEvent.id, ...activeEvent.relatedIds]) : null;
  const visible = relationships.filter((relationship) => {
    if (relationshipMode) return positions.has(relationship.sourceId) && positions.has(relationship.targetId);
    return relatedIds?.has(relationship.sourceId) && relatedIds.has(relationship.targetId);
  });

  return (
    <>
      {visible.slice(0, relationshipMode ? 80 : 16).map((relationship) => {
        const source = positions.get(relationship.sourceId);
        const target = positions.get(relationship.targetId);
        if (!source || !target) return null;
        const midY = Math.min(source.y, target.y) - 26;
        return (
          <motion.path
            key={relationship.id}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: relationshipMode ? 0.36 : 0.82 }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
            d={`M ${source.x} ${source.y} C ${source.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y}`}
            fill="none"
            stroke="#67e8f9"
            strokeWidth="1.4"
            strokeDasharray={relationshipMode ? "4 7" : "none"}
          />
        );
      })}
    </>
  );
}

const TimelineMinimap = React.forwardRef<HTMLCanvasElement, {
  startLabel: string;
  endLabel: string;
  onJump: (ratio: number) => void;
}>(function TimelineMinimap(
  {
    startLabel,
    endLabel,
    onJump,
  },
  ref: React.ForwardedRef<HTMLCanvasElement>,
) {
  return (
    <div className="border-t border-slate-800/80 bg-[#050914] px-3 py-2">
      <div className="grid h-full grid-cols-[120px_minmax(0,1fr)_120px] items-center gap-3">
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <MapIcon className="h-4 w-4" />
          <span className="font-mono">{startLabel}</span>
        </div>
        <canvas
          ref={ref}
          className="h-12 w-full cursor-pointer rounded border border-slate-800 bg-slate-950"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onJump((event.clientX - rect.left) / rect.width);
          }}
        />
        <div className="text-right font-mono text-[12px] text-slate-500">{endLabel}</div>
      </div>
    </div>
  );
});

function durationLabel(event: NormalizedEvent) {
  const hours = Math.max(0, differenceInHours(new Date(event.endMs), new Date(event.startMs)));
  if (hours >= 24) return `${Math.round(hours / 24)}d`;
  if (hours > 0) return `${hours}h`;
  return format(new Date(event.startMs), "HH:mm");
}

export function FloatingTimelineInspector({
  event,
  relationships,
  allEvents,
  onUpload,
  onDelete,
  onEdit,
  onOpenFull,
  spacious = false,
}: {
  event?: EventItem;
  relationships: Relationship[];
  allEvents: EventItem[];
  onUpload: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onDelete: (eventId: string) => void;
  onEdit: (event: EventItem) => void;
  onOpenFull?: () => void;
  spacious?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    summary: true,
    metadata: true,
    people: true,
    evidence: true,
    actions: true,
    relationships: true,
  });
  const [isUploading, setIsUploading] = useState(false);
  const submitUpload = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setIsUploading(true);
    try {
      await onUpload(submitEvent);
    } finally {
      setIsUploading(false);
    }
  };
  if (!event) {
    return (
      <div className="p-4">
        <div className="rounded-md border border-slate-800 bg-slate-950/85 p-4 text-sm text-slate-400 shadow-2xl">Select an event to inspect evidence and links.</div>
      </div>
    );
  }
  const start = dateOf(event.startDate);
  const linked = relationships
    .filter((relationship) => relationship.sourceId === event.id || relationship.targetId === event.id)
    .map((relationship) => ({
      relationship,
      other: allEvents.find((item) => item.id === (relationship.sourceId === event.id ? relationship.targetId : relationship.sourceId)),
    }));
  const previous = [...allEvents].filter((item) => dateOf(item.startDate).getTime() < start.getTime()).at(-1);
  const next = [...allEvents].find((item) => dateOf(item.startDate).getTime() > start.getTime());

  return (
    <div className={cn("p-4", spacious && "p-6")}>
      <motion.div
        layout
        className="rounded-md border border-slate-700/70 bg-[#070c17]/95 shadow-2xl shadow-black/35 ring-1 ring-white/[0.03]"
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            <PanelRight className="h-3.5 w-3.5" />
            Inspector
          </div>
          <div className="flex items-center gap-1">
            {onOpenFull && (
              <Button type="button" variant="ghost" size="icon" onClick={onOpenFull} title="Open event detail">
                <Maximize2 className="h-4 w-4" />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(event)} title="Edit event">
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => onDelete(event.id)} title="Archive event">
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="mt-1 h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,.5)]" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold leading-6 text-slate-50">{event.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[12px] text-cyan-100">
                <Clock3 className="h-3.5 w-3.5" />
                {format(start, "dd MMM yyyy HH:mm")}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge className="bg-slate-800 text-slate-200">{event.eventType}</Badge>
            <Badge className="bg-slate-800 text-slate-200">{event.category}</Badge>
            <Badge className="bg-cyan-300/10 text-cyan-100">{event.importance}</Badge>
            <Badge className="bg-slate-800 text-slate-200">{event.status}</Badge>
          </div>
        </div>

        <InspectorSection id="summary" title="Summary" icon={FileCheck2} open={open.summary} setOpen={setOpen}>
          <p className="text-[13px] leading-6 text-slate-300">{event.description || "No summary recorded."}</p>
          {event.notes && <p className="mt-3 line-clamp-4 text-[12px] leading-5 text-slate-500">{event.notes}</p>}
        </InspectorSection>

        <InspectorSection id="metadata" title="Metadata" icon={Tag} open={open.metadata} setOpen={setOpen}>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <Metadata label="Created" value={format(dateOf(event.createdAt), "dd MMM yyyy")} />
            <Metadata label="Duration" value={durationLabel({ ...event, lane: eventLane(event), relatedIds: [], startMs: start.getTime(), endMs: event.endDate ? dateOf(event.endDate).getTime() : start.getTime() })} />
            <Metadata label="Tags" value={event.tags.length ? event.tags.map((item) => item.tag.name).join(", ") : "None"} />
            <Metadata label="Evidence" value={String(event.documents.length)} />
          </div>
        </InspectorSection>

        <InspectorSection id="people" title="People" icon={Users} open={open.people} setOpen={setOpen}>
          <div className="space-y-2">
            {event.people.length === 0 && <EmptyLine label="No people linked" />}
            {event.people.map((item) => (
              <div key={item.person.id} className="rounded border border-slate-800 bg-slate-950/70 p-2">
                <div className="text-[13px] font-medium text-slate-200">{item.person.name}</div>
                <div className="mt-0.5 text-[12px] text-slate-500">{item.role || item.person.role}</div>
              </div>
            ))}
          </div>
        </InspectorSection>

        <InspectorSection id="evidence" title="Evidence" icon={FileCheck2} open={open.evidence} setOpen={setOpen}>
          <div className="space-y-2">
            {event.documents.length === 0 && <EmptyLine label="No evidence attached" />}
            {event.documents.map((item) => (
              <a key={item.document.id} href={item.document.path ? `/api/evidence/${encodeURIComponent(item.document.id)}/download` : undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/70 p-2 hover:border-cyan-300/50">
                <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-200" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-slate-200">{item.document.title || item.document.filename}</span>
                  <span className="block truncate text-[12px] text-slate-500">{item.document.confidenceLevel}</span>
                </span>
              </a>
            ))}
          </div>
          <form onSubmit={submitUpload} className="mt-3 space-y-2">
            <Input name="title" placeholder="Evidence title" className="h-9" />
            <Input type="file" name="file" accept={EVIDENCE_FILE_ACCEPT} required className="h-9" />
            <p className="text-[12px] text-slate-500">Standard evidence up to 4 MB; ZIP evidence up to 500 MB.</p>
            <input name="description" placeholder="Evidence description" className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400" />
            <input name="sourceType" defaultValue="Other" className="hidden" />
            <input name="sourceReference" className="hidden" />
            <input name="confidenceLevel" defaultValue="Documented" className="hidden" />
            <Button type="submit" variant="secondary" size="sm" disabled={isUploading}>
              <FileCheck2 className="h-4 w-4" />
              {isUploading ? "Uploading…" : "Attach"}
            </Button>
          </form>
        </InspectorSection>

        <InspectorSection id="actions" title="Actions" icon={CheckCircle2} open={open.actions} setOpen={setOpen}>
          <div className="space-y-2">
            {event.actions?.length ? (
              event.actions.map((action) => (
                <div key={action.id} className="rounded border border-slate-800 bg-slate-950/70 p-2">
                  <div className="text-[13px] text-slate-200">{action.title}</div>
                  <div className="mt-0.5 text-[12px] text-slate-500">{action.status}</div>
                </div>
              ))
            ) : (
              <EmptyLine label="No actions linked" />
            )}
          </div>
        </InspectorSection>

        <InspectorSection id="relationships" title="Timeline relationships" icon={Waypoints} open={open.relationships} setOpen={setOpen}>
          <div className="grid grid-cols-2 gap-2">
            <NeighbourEvent label="Previous" event={previous} />
            <NeighbourEvent label="Next" event={next} />
          </div>
          <div className="mt-2 space-y-2">
            {linked.length === 0 && <EmptyLine label="No linked events" />}
            {linked.map(({ relationship, other }) => (
              <div key={relationship.id} className="rounded border border-slate-800 bg-slate-950/70 p-2">
                <div className="flex items-center gap-1.5 text-[12px] text-cyan-200">
                  <Link2 className="h-3.5 w-3.5" />
                  {relationship.relationshipType}
                </div>
                <div className="mt-1 truncate text-[13px] text-slate-200">{other?.title ?? "Unknown event"}</div>
              </div>
            ))}
          </div>
        </InspectorSection>
      </motion.div>
    </div>
  );
}

function InspectorSection({
  id,
  title,
  icon: Icon,
  open,
  setOpen,
  children,
}: {
  id: string;
  title: string;
  icon: typeof Search;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((current) => ({ ...current, [id]: !current[id] }))}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none hover:bg-slate-900/70 focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-200">
          <Icon className="h-3.5 w-3.5 text-slate-500" />
          {title}
        </span>
        {open ? <ArrowUp className="h-3.5 w-3.5 text-slate-500" /> : <ArrowDown className="h-3.5 w-3.5 text-slate-500" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-1 truncate font-mono text-[12px] text-slate-300">{value}</div>
    </div>
  );
}

function EmptyLine({ label }: { label: string }) {
  return <div className="rounded border border-dashed border-slate-800 bg-slate-950/40 p-2 text-[12px] text-slate-600">{label}</div>;
}

function NeighbourEvent({ label, event }: { label: string; event?: EventItem }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-1 truncate text-[12px] text-slate-300">{event?.title ?? "None"}</div>
    </div>
  );
}
