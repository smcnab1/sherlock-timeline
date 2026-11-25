import type { Tag } from "@/lib/types";

export function tagTotal(tag: Tag) {
  return (tag._count?.events ?? 0) + (tag._count?.documents ?? 0);
}

export function materialHasTag(
  links: Array<{ tag: Pick<Tag, "id"> }>,
  tagId: string,
) {
  return links.some((link) => link.tag.id === tagId);
}

export function sortAndFilterTags(
  tags: Tag[],
  query: string,
  sort: "name" | "total",
) {
  const needle = query.trim().toLowerCase();
  return tags
    .filter((tag) => tag.name.toLowerCase().includes(needle))
    .sort((left, right) => {
      if (sort === "total") {
        const difference = tagTotal(right) - tagTotal(left);
        if (difference) return difference;
      }
      return left.name.localeCompare(right.name, "en-GB", {
        sensitivity: "base",
        numeric: true,
      });
    });
}
