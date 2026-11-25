"use client";

import { Check, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { TagBadge } from "@/components/tags/tag-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_TAG_COLOUR } from "@/lib/tagging";
import type { Tag } from "@/lib/types";

export function TagMultiSelect({
  tags,
  defaultSelectedIds = [],
  onCreateTag,
  label = "Tags",
}: {
  tags: Tag[];
  defaultSelectedIds?: string[];
  onCreateTag: (name: string, colour: string) => Promise<Tag>;
  label?: string;
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(defaultSelectedIds));
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newColour, setNewColour] = useState(DEFAULT_TAG_COLOUR);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const visibleTags = useMemo(
    () => tags.filter((tag) => tag.name.toLowerCase().includes(query.trim().toLowerCase())),
    [query, tags],
  );
  const selectedTags = tags.filter((tag) => selectedIds.has(tag.id));

  function toggle(tagId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function createTag() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const created = await onCreateTag(newName, newColour);
      setSelectedIds((current) => new Set([...current, created.id]));
      setNewName("");
      setQuery("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The tag could not be created.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <fieldset className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</legend>
      <div className="mb-3 flex min-h-7 flex-wrap gap-2">
        {selectedTags.length ? selectedTags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggle(tag.id)}
            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label={`Remove ${tag.name} tag`}
          >
            <TagBadge tag={tag} />
          </button>
        )) : <span className="text-sm text-slate-500">No tags selected.</span>}
      </div>
      {tags.filter((tag) => selectedIds.has(tag.id)).map((tag) => (
        <input key={tag.id} type="hidden" name="tagIds" value={tag.id} />
      ))}
      <details className="rounded border border-slate-800 bg-slate-950 open:pb-3">
        <summary className="cursor-pointer px-3 py-2 text-sm text-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400">
          Choose or create tags
        </summary>
        <div className="space-y-3 border-t border-slate-800 px-3 pt-3">
          <label className="relative block">
            <span className="sr-only">Search available tags</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" aria-hidden="true" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tags" className="pl-9" />
          </label>
          <div className="max-h-44 space-y-1 overflow-auto" aria-label="Available tags">
            {visibleTags.map((tag) => {
              const selected = selectedIds.has(tag.id);
              return (
                <label key={tag.id} className="flex cursor-pointer items-center gap-3 rounded border border-slate-800 px-3 py-2 hover:border-slate-600 focus-within:ring-2 focus-within:ring-cyan-400">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggle(tag.id)}
                    className="sr-only"
                  />
                  <span className="flex h-5 w-5 items-center justify-center rounded border border-slate-600" aria-hidden="true">
                    {selected ? <Check className="h-4 w-4 text-cyan-300" /> : null}
                  </span>
                  <TagBadge tag={tag} />
                  <span className="ml-auto text-xs text-slate-500">{selected ? "Selected" : "Not selected"}</span>
                </label>
              );
            })}
            {!visibleTags.length && <p className="py-2 text-sm text-slate-500">No matching tags.</p>}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_3rem_auto] gap-2 border-t border-slate-800 pt-3">
            <label>
              <span className="sr-only">New tag name</span>
              <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="New tag name" maxLength={64} />
            </label>
            <label className="flex h-10 items-center justify-center rounded-md border border-slate-700 bg-slate-950">
              <span className="sr-only">New tag colour</span>
              <input type="color" value={newColour} onChange={(event) => setNewColour(event.target.value)} className="h-7 w-8 cursor-pointer bg-transparent" />
            </label>
            <Button type="button" size="sm" onClick={createTag} disabled={creating || !newName.trim()}>
              {creating ? <X className="h-4 w-4 animate-pulse" /> : <Plus className="h-4 w-4" />} Create
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </div>
      </details>
    </fieldset>
  );
}
