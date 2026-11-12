import type { TagCount } from "@wiki-agents/contracts/search/list-tags/response";

/** A tag and the tags nested under it (`project` holds `project/app`). */
export interface TagNode {
  /** The last part of the tag (`app` for `project/app`). */
  readonly name: string;
  /** The whole tag, as written in notes. */
  readonly tag: string;
  /** Notes with exactly this tag. */
  readonly count: number;
  /** Notes with this tag or one nested under it, counted once per tag. */
  readonly total: number;
  readonly children: ReadonlyArray<TagNode>;
}

interface Building {
  name: string;
  tag: string;
  count: number;
  children: Map<string, Building>;
}

const finish = (node: Building): TagNode => {
  const children = [...node.children.values()].map(finish).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { name: node.name, tag: node.tag, count: node.count, total: node.count + children.reduce((sum, child) => sum + child.total, 0), children };
};

/**
 * Tags nested by `/`, sorted by name. A parent nobody uses on its own still shows
 * (count 0), so its children have somewhere to hang. Only tags matching `filter`
 * (anywhere in the whole tag, ignoring case) and their parents are kept.
 */
export const tagTree = (tags: ReadonlyArray<TagCount>, filter = ""): ReadonlyArray<TagNode> => {
  const wanted = filter.trim().replace(/^#/, "").toLowerCase();
  const root = new Map<string, Building>();
  for (const { tag, count } of tags) {
    if (wanted !== "" && !tag.toLowerCase().includes(wanted)) continue;
    const parts = tag.split("/").filter((part) => part !== "");
    let level = root;
    let parent = "";
    parts.forEach((part, index) => {
      const key = part.toLowerCase();
      let node = level.get(key);
      if (node === undefined) {
        node = { name: part, tag: parent === "" ? part : `${parent}/${part}`, count: 0, children: new Map() };
        level.set(key, node);
      }
      if (index === parts.length - 1) node.count += count;
      parent = node.tag;
      level = node.children;
    });
  }
  return finish({ name: "", tag: "", count: 0, children: root }).children;
};
