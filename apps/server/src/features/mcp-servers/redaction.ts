/**
 * Keeping secret values out of what the app shows or hands on: errors, statuses and tool
 * results. An upstream server can echo a token back (in an error, or a tool that prints
 * its request), so everything from it passes through here.
 */

export const REDACTED = "[redacted]";

/**
 * Values shorter than this aren't replaced: a one- or two-character "secret" would
 * mangle every result, and isn't one worth hiding.
 */
export const MIN_REDACTED_LENGTH = 4;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Something that replaces each of `values` in a text, also as JSON writes it inside a
 * string (a value with a quote or backslash, in a result that holds JSON as text),
 * longest first so one value inside another goes whole.
 */
export const makeRedactor = (values: Iterable<string>): ((text: string) => string) => {
  const forms = new Set<string>();
  for (const value of values) {
    if (value.length < MIN_REDACTED_LENGTH) continue;
    forms.add(value);
    forms.add(JSON.stringify(value).slice(1, -1));
  }
  if (forms.size === 0) return (text) => text;
  const pattern = new RegExp([...forms].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "g");
  return (text) => text.replace(pattern, REDACTED);
};

/** `value` (plain JSON data) with every string in it redacted, keys included. */
export const redactJson = (value: unknown, redact: (text: string) => string): unknown => {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, redact));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactJson(item, redact)]));
  }
  return value;
};
