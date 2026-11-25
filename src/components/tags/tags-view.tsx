"use client";

import { CalendarClock, Check, Edit3, Files, Plus, Search, Tag as TagIcon, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { TagBadge } from "@/components/tags/tag-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_TAG_COLOUR } from "@/lib/tagging";
import { materialHasTag, sortAndFilterTags, tagTotal } from "@/lib/tag-view";
import type { DocumentItem, EventItem, Tag } from "@/lib/types";

function dateOf(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(dateOf(value));
}

export function TagsView({
  tags,
  events,
  evidence,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onOpenEvent,
  onOpenEvidence,
}: {
  tags: Tag[];
  events: EventItem[];
  evidence: DocumentItem[];
  onCreateTag: (name: string, colour: string) => Promise<Tag>;
  onUpdateTag: (tag: Tag, name: string, colour: string) => Promise<Tag>;
  onDeleteTag: (tag: Tag) => Promise<void>;
  onOpenEvent: (event: EventItem) => void;
  onOpenEvidence: (item: DocumentItem) => void;
}) {
  const [selectedTagId, setSelectedTagId] = useState(tags[0]?.id ?? "");
  const [tagQuery, setTagQuery] = useState("");
  const [recordQuery, setRecordQuery] = useState("");
  const [sort, setSort] = useState<"name" | "total">("name");
  const [newName, setNewName] = useState("");
  const [newColour, setNewColour] = useState(DEFAULT_TAG_COLOUR);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sortedTags = useMemo(() => sortAndFilterTags(tags, tagQuery, sort), [sort, tagQuery, tags]);
  const selected = tags.find((tag) => tag.id === selectedTagId) ?? tags[0] ?? null;
  const materialQuery = recordQuery.trim().toLowerCase();
  const matchingEvents = selected ? events
    .filter((event) => materialHasTag(event.tags, selected.id))
    .filter((event) => !materialQuery || `${event.title} ${event.eventType} ${event.category} ${event.importance}`.toLowerCase().includes(materialQuery))
    .sort((left, right) => dateOf(right.startDate).getTime() - dateOf(left.startDate).getTime()) : [];
  const matchingEvidence = selected ? evidence
    .filter((item) => materialHasTag(item.tags, selected.id))
    .filter((item) => !materialQuery || `${item.title} ${item.filename} ${item.sourceType} ${item.confidenceLevel}`.toLowerCase().includes(materialQuery))
    .sort((left, right) => dateOf(right.uploadedAt).getTime() - dateOf(left.uploadedAt).getTime()) : [];

  async function createTag() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await onCreateTag(newName, newColour);
      setNewName("");
      setSelectedTagId(created.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The tag could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onUpdateTag(editing, String(form.get("name") || ""), String(form.get("colour") || ""));
      setEditing(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "The tag could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || busy) return;
    setBusy(true);
    setError("");
    try {
      await onDeleteTag(deleting);
      setDeleting(null);
      if (selectedTagId === deleting.id) setSelectedTagId("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The tag could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-auto border-b border-slate-800 bg-slate-900/60 p-5 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2"><TagIcon className="h-5 w-5 text-cyan-300" /><h2 className="font-semibold">Tags</h2></div>
        <p className="mt-1 text-sm text-slate-400">Reusable themes for chronology and evidence.</p>
        <div className="mt-4 space-y-2">
          <label className="relative block"><span className="sr-only">Search tags</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><Input value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="Search tags" className="pl-9" /></label>
          <label className="block text-xs text-slate-400">Sort tags<select value={sort} onChange={(event) => setSort(event.target.value as "name" | "total")} className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"><option value="name">Name A–Z</option><option value="total">Most assignments</option></select></label>
        </div>
        <div className="mt-4 space-y-2">
          {sortedTags.map((tag) => (
            <button key={tag.id} type="button" onClick={() => setSelectedTagId(tag.id)} aria-pressed={selected?.id === tag.id} className={`w-full rounded-md border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${selected?.id === tag.id ? "border-cyan-400 bg-cyan-400/10" : "border-slate-800 bg-slate-950 hover:border-slate-600"}`}>
              <div className="flex items-start justify-between gap-2"><TagBadge tag={tag} /><span className="flex items-center gap-1 font-mono text-sm text-slate-300">{selected?.id === tag.id && <><Check className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Selected. </span></>}{tagTotal(tag)}</span></div>
              <div className="mt-2 flex gap-3 text-xs text-slate-500"><span>{tag._count?.events ?? 0} events</span><span>{tag._count?.documents ?? 0} evidence</span></div>
            </button>
          ))}
          {!sortedTags.length && <p className="rounded border border-dashed border-slate-700 p-4 text-sm text-slate-500">{tags.length ? "No tags match your search." : "No tags yet. Create one below."}</p>}
        </div>
        <div className="mt-5 space-y-2 border-t border-slate-800 pt-4">
          <h3 className="text-sm font-semibold">Create tag</h3>
          <div className="grid grid-cols-[minmax(0,1fr)_3rem] gap-2"><Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Tag name" maxLength={64} aria-label="New tag name" /><label className="flex h-10 items-center justify-center rounded border border-slate-700"><span className="sr-only">New tag colour</span><input type="color" value={newColour} onChange={(event) => setNewColour(event.target.value)} /></label></div>
          <Button type="button" size="sm" onClick={createTag} disabled={busy || !newName.trim()}><Plus className="h-4 w-4" /> Create tag</Button>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </div>
      </aside>

      <section className="min-h-0 overflow-auto p-5 lg:p-6">
        {!selected ? <div className="flex h-full min-h-64 items-center justify-center rounded-md border border-dashed border-slate-700 text-center text-slate-400"><div><TagIcon className="mx-auto mb-3 h-8 w-8" /><p className="font-medium text-slate-200">Create your first tag</p><p className="mt-1 text-sm">Tags bring related events and evidence together.</p></div></div> : <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><TagBadge tag={selected} className="text-sm" /><p className="mt-2 text-sm text-slate-400">{tagTotal(selected)} matching item{tagTotal(selected) === 1 ? "" : "s"}, kept separate by material type.</p></div>
            <div className="flex gap-2"><Button type="button" variant="secondary" size="sm" onClick={() => { setError(""); setEditing(selected); }}><Edit3 className="h-4 w-4" /> Edit</Button><Button type="button" variant="danger" size="sm" onClick={() => { setError(""); setDeleting(selected); }}><Trash2 className="h-4 w-4" /> Delete</Button></div>
          </div>
          <label className="relative mt-5 block"><span className="sr-only">Search material with this tag</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><Input value={recordQuery} onChange={(event) => setRecordQuery(event.target.value)} placeholder={`Search material tagged ${selected.name}`} className="pl-9" /></label>
          <MaterialGroup title="Timeline events" icon={CalendarClock} count={matchingEvents.length} empty={recordQuery ? "No tagged events match your search." : "No timeline events use this tag yet."}>
            {matchingEvents.map((event) => <button key={event.id} type="button" onClick={() => onOpenEvent(event)} className="w-full rounded-md border border-slate-800 bg-slate-900 p-4 text-left outline-none hover:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-400"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{event.title}</h4><p className="mt-1 text-xs text-slate-500">{formatDate(event.startDate)} · {event.eventType} · {event.category}</p></div><Badge className="bg-slate-800 text-slate-200">{event.importance}</Badge></div></button>)}
          </MaterialGroup>
          <MaterialGroup title="Evidence" icon={Files} count={matchingEvidence.length} empty={recordQuery ? "No tagged evidence matches your search." : "No evidence uses this tag yet."}>
            {matchingEvidence.map((item) => <button key={item.id} type="button" onClick={() => onOpenEvidence(item)} className="w-full rounded-md border border-slate-800 bg-slate-900 p-4 text-left outline-none hover:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-400"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{item.title || item.filename}</h4><p className="mt-1 text-xs text-slate-500">Uploaded {formatDate(item.uploadedAt)} · {item.sourceType}</p></div><Badge className="bg-sky-500/20 text-sky-100">{item.confidenceLevel}</Badge></div></button>)}
          </MaterialGroup>
          {!matchingEvents.length && !matchingEvidence.length && recordQuery && <p className="mt-6 rounded border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">No results across events or evidence.</p>}
        </>}
      </section>

      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"><form onSubmit={saveEdit} className="w-full max-w-md space-y-4 rounded-md border border-slate-700 bg-slate-900 p-5"><h2 className="text-lg font-semibold">Edit tag</h2><label className="block text-sm">Name<Input name="name" defaultValue={editing.name} maxLength={64} required className="mt-1" /></label><label className="block text-sm">Colour<input name="colour" type="color" defaultValue={editing.colour} className="ml-3 align-middle" /></label>{error && <p role="alert" className="text-sm text-red-300">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={busy}>Save</Button></div></form></div>}
      {deleting && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="delete-tag-title" className="w-full max-w-md rounded-md border border-slate-700 bg-slate-900 p-5"><h2 id="delete-tag-title" className="text-lg font-semibold">Delete tag</h2><p className="mt-3 text-sm leading-6 text-slate-300">Delete “{deleting.name}”? This removes {deletionTotal(deleting)} assignment{deletionTotal(deleting) === 1 ? "" : "s"} from events and evidence. The material itself will not be deleted.</p>{error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button><Button type="button" variant="danger" onClick={confirmDelete} disabled={busy}><Trash2 className="h-4 w-4" /> Delete tag</Button></div></div></div>}
    </div>
  );
}

function MaterialGroup({ title, icon: Icon, count, empty, children }: { title: string; icon: typeof Files; count: number; empty: string; children: React.ReactNode }) {
  return <section className="mt-6"><div className="mb-3 flex items-center gap-2"><Icon className="h-4 w-4 text-cyan-300" /><h3 className="font-semibold">{title}</h3><Badge className="bg-slate-800 text-slate-200">{count}</Badge></div><div className="space-y-2">{count ? children : <p className="rounded border border-dashed border-slate-700 p-4 text-sm text-slate-500">{empty}</p>}</div></section>;
}

function deletionTotal(tag: Tag) {
  return tag.assignmentCount ?? tagTotal(tag);
}
