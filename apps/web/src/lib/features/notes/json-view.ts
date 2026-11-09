export type Json = string | number | boolean | null | ReadonlyArray<Json> | { readonly [key: string]: Json };

export type ParsedJson =
  | { readonly ok: true; readonly value: Json; readonly decodedFromString: boolean }
  | { readonly ok: false; readonly message: string };

/**
 * Parses a JSON file. A file whose whole content is a JSON *string* holding an object
 * or array (double-encoded, as some scrapers write) is decoded once more.
 */
export const parseJson = (text: string): ParsedJson => {
  let value: Json;
  try {
    value = JSON.parse(text) as Json;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid JSON" };
  }
  if (typeof value === "string" && /^\s*[[{]/.test(value)) {
    try {
      return { ok: true, value: JSON.parse(value) as Json, decodedFromString: true };
    } catch {
      // A string that only looks like JSON: show it as it is.
    }
  }
  return { ok: true, value, decodedFromString: false };
};

export const isContainer = (value: Json): value is ReadonlyArray<Json> | { readonly [key: string]: Json } =>
  typeof value === "object" && value !== null;

/** Children of an object or array as [key, value] pairs (array keys are indexes). */
export const entriesOf = (value: ReadonlyArray<Json> | { readonly [key: string]: Json }): ReadonlyArray<readonly [string, Json]> =>
  Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);

export const summaryOf = (value: ReadonlyArray<Json> | { readonly [key: string]: Json }) => {
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  return Array.isArray(value) ? `[ ${count} ${count === 1 ? "item" : "items"} ]` : `{ ${count} ${count === 1 ? "key" : "keys"} }`;
};

/** Only http(s) strings become links; anything else (javascript:, data:) stays text. */
export const isWebUrl = (value: string) => /^https?:\/\/[^\s]+$/i.test(value);

/** Stable identity for a node: its key path. */
export const nodeId = (path: ReadonlyArray<string>) => JSON.stringify(path);

/** Ids of every container down to `depth` levels below the root (the root is level 0). */
export const containersTo = (value: Json, depth: number, path: ReadonlyArray<string> = [], ids: Array<string> = []) => {
  if (!isContainer(value) || path.length > depth) return ids;
  ids.push(nodeId(path));
  for (const [key, child] of entriesOf(value)) containersTo(child, depth, [...path, key], ids);
  return ids;
};
