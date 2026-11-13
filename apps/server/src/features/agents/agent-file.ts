import { AUTONOMY_ACTIONS, type AgentInput } from "@wiki-agents/contracts/agents/model";
import { Document, isMap, isScalar, type Pair, parseDocument, YAMLMap } from "yaml";
import { splitFrontmatter } from "./definition.js";

/** The order settings are written in; a setting the file doesn't have yet goes after the ones before it. */
const ORDER = ["name", "description", "provider", "model", "sources", "autonomy", "concurrency"] as const;
type Key = (typeof ORDER)[number];

const keyOf = (pair: Pair) => (isScalar(pair.key) ? String(pair.key.value) : String(pair.key));

/**
 * An agent file with `input`'s settings and instructions. When `existing` (the file
 * as it is on disk) has frontmatter, it is edited in place, so comments, key order
 * and settings the editor doesn't show (`tags`) stay. Settings left at their
 * defaults are removed rather than written out: no provider or model, no
 * description, no sources.
 *
 * The result isn't checked here; the caller parses it as the loader would.
 */
export const agentFileText = (input: AgentInput, existing: string | null): string => {
  const yaml = existing === null ? null : splitFrontmatter(existing).yaml;
  let doc: Document = yaml === null ? new Document(new YAMLMap()) : parseDocument(yaml);
  // Frontmatter that isn't a map (or doesn't parse) can't be edited in place.
  if (doc.errors.length > 0 || !isMap(doc.contents)) doc = new Document(new YAMLMap());
  const map = doc.contents as YAMLMap;
  const indexOf = (key: string) => map.items.findIndex((pair) => keyOf(pair) === key);

  const set = (key: Key, value: unknown) => {
    const at = indexOf(key);
    const current = at >= 0 ? map.items[at]!.value : undefined;
    // A plain value is changed where it is, keeping a comment after it on its line.
    if (isScalar(current) && (typeof value === "string" || typeof value === "number")) {
      current.value = value;
      return;
    }
    const node = doc.createNode(value, { flow: key === "sources" && Array.isArray(value) && value.every((item) => typeof item === "string") });
    if (at >= 0) {
      map.items[at]!.value = node;
      return;
    }
    // After the nearest setting that comes before it, else first.
    const before = ORDER.slice(0, ORDER.indexOf(key)).map(indexOf).filter((index) => index >= 0);
    map.items.splice(before.length === 0 ? 0 : Math.max(...before) + 1, 0, doc.createPair(key, node));
  };

  /** Removes the setting; a comment above it moves to whatever follows, so help text in the file stays. */
  const remove = (key: Key) => {
    const at = indexOf(key);
    if (at < 0) return;
    const pair = map.items[at]!;
    const comment = isScalar(pair.key) ? pair.key.commentBefore : undefined;
    map.items.splice(at, 1);
    if (comment === undefined || comment === null) return;
    const next = map.items[at];
    if (next !== undefined && isScalar(next.key)) next.key.commentBefore = next.key.commentBefore ? `${comment}\n${next.key.commentBefore}` : comment;
    else map.comment = map.comment ? `${comment}\n${map.comment}` : comment;
  };

  set("name", input.name.trim());
  if (input.description.trim() === "") remove("description");
  else set("description", input.description.trim());
  if (input.provider === null) remove("provider");
  else set("provider", input.provider);
  if (input.model === null) remove("model");
  else set("model", input.model.trim());
  if (input.sources.length === 0) {
    remove("sources");
  } else {
    set(
      "sources",
      input.sources.map((source) =>
        typeof source === "string" ? source : source.folders.length === 0 ? { vault: source.vault } : { vault: source.vault, folders: source.folders },
      ),
    );
  }
  const autonomy = map.get("autonomy");
  if (isMap(autonomy)) {
    for (const action of AUTONOMY_ACTIONS) autonomy.set(action, input.autonomy[action]);
  } else {
    set("autonomy", Object.fromEntries(AUTONOMY_ACTIONS.map((action) => [action, input.autonomy[action]])));
  }
  set("concurrency", input.concurrency);

  const frontmatter = doc.toString({ lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${input.instructions.trim()}\n`;
};
