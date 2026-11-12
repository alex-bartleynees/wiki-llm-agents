/**
 * New notes from templates, as Obsidian's core Templates plugin does: a template is
 * any note in the vault's template folder, and `{{title}}`, `{{date}}`, `{{time}}`,
 * `{{date:FORMAT}}` and `{{time:FORMAT}}` are filled in when the note is made.
 */

export interface Template {
  readonly path: string;
  /** Its path inside the template folder, without `.md`. */
  readonly name: string;
}

/** The notes in `folder` and its subfolders, by name. */
export const templatesIn = (paths: ReadonlyArray<string>, folder: string | null): ReadonlyArray<Template> => {
  if (folder === null || folder === "") return [];
  const prefix = `${folder}/`;
  return paths
    .filter((path) => path.startsWith(prefix) && path.toLowerCase().endsWith(".md"))
    .map((path) => ({ path, name: path.slice(prefix.length, -3) }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** Moment.js tokens, longest first; `[text]` is kept as written. */
const TOKENS = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g;

/** Formats a local date with the moment.js tokens Obsidian's templates use. */
export const formatDate = (date: Date, format: string): string =>
  format.replace(TOKENS, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    const hours12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
    switch (token) {
      case "YYYY":
        return String(date.getFullYear());
      case "YY":
        return pad(date.getFullYear() % 100);
      case "MMMM":
        return MONTHS[date.getMonth()] ?? "";
      case "MMM":
        return (MONTHS[date.getMonth()] ?? "").slice(0, 3);
      case "MM":
        return pad(date.getMonth() + 1);
      case "M":
        return String(date.getMonth() + 1);
      case "DD":
        return pad(date.getDate());
      case "D":
        return String(date.getDate());
      case "dddd":
        return DAYS[date.getDay()] ?? "";
      case "ddd":
        return (DAYS[date.getDay()] ?? "").slice(0, 3);
      case "HH":
        return pad(date.getHours());
      case "H":
        return String(date.getHours());
      case "hh":
        return pad(hours12);
      case "h":
        return String(hours12);
      case "mm":
        return pad(date.getMinutes());
      case "m":
        return String(date.getMinutes());
      case "ss":
        return pad(date.getSeconds());
      case "s":
        return String(date.getSeconds());
      case "A":
        return date.getHours() < 12 ? "AM" : "PM";
      default:
        return date.getHours() < 12 ? "am" : "pm";
    }
  });

/** Fills in a template's `{{…}}` placeholders; unknown ones are left as written. */
export const renderTemplate = (template: string, values: { readonly title: string; readonly now: Date }): string =>
  template.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi, (_match, name: string, format: string | undefined) => {
    const key = name.toLowerCase();
    if (key === "title") return values.title;
    const chosen = format?.trim() || (key === "date" ? "YYYY-MM-DD" : "HH:mm");
    return formatDate(values.now, chosen);
  });

/**
 * The file name for a note title: characters that break a file name or a wikilink
 * (`\ / : * ? " < > | # ^ [ ]`) are dropped, as Obsidian refuses them. Undefined when
 * nothing is left.
 */
export const noteFileName = (title: string): string | undefined => {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .replace(/\.md$/i, "")
    .trim();
  return cleaned === "" ? undefined : `${cleaned}.md`;
};

/** Where a new note goes: `folder/Title.md`, or `Title.md` at the top. */
export const newNotePath = (folder: string, fileName: string) => (folder === "" ? fileName : `${folder}/${fileName}`);

/** Every folder that holds a file, and their parents, sorted; "" is the vault's top. */
export const foldersOf = (paths: ReadonlyArray<string>): ReadonlyArray<string> => {
  const folders = new Set<string>([""]);
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    for (let depth = 1; depth <= parts.length; depth += 1) folders.add(parts.slice(0, depth).join("/"));
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
};
