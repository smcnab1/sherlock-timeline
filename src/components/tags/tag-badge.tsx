import { Tag as TagIcon } from "lucide-react";
import type { Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TagBadge({ tag, className }: { tag: Tag; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border bg-slate-900 px-2 py-0.5 text-xs font-medium text-slate-100",
        className,
      )}
      style={{ borderColor: tag.colour, boxShadow: `inset 3px 0 0 ${tag.colour}` }}
      title={`Tag: ${tag.name}`}
    >
      <TagIcon className="h-3 w-3" aria-hidden="true" />
      {tag.name}
    </span>
  );
}
