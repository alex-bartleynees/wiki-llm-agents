/**
 * The CSV the providers' `csv` fixtures analyse: sent as an attachment (listed by
 * path in the message), read by the agent with its own tools from the app's
 * attachments folder, outside the vault.
 */
import { join } from "node:path";
import { attachedFilesText } from "../../src/features/threads/attached-files.js";
import { ATTACHMENTS, sha256 } from "./image.js";

export const SALES_CSV = {
  name: "sales.csv",
  mime: "text/csv",
  bytes: new TextEncoder().encode("region,amount\nnorth,120\nsouth,75\neast,40\nwest,15\n"),
} as const;

/** The sum of the amount column. */
export const SALES_TOTAL = "250";

export const CSV_PROMPT = "Read the attached CSV and reply with the total of the amount column, as just the number. Don't write any files.";

/** Where the store keeps the CSV under an attachments folder: `<root>/<sha256>/<name>`, as the app does. */
export const csvPath = (root: string) => join(root, sha256(SALES_CSV.bytes), SALES_CSV.name);

/** The message the app sends a provider for the CSV prompt with the CSV attached under `root` (see `thread-actor.ts` `dispatch`). */
export const csvMessage = (root: string) =>
  [
    CSV_PROMPT,
    attachedFilesText([{ id: "", name: SALES_CSV.name, mime: SALES_CSV.mime, size: SALES_CSV.bytes.length, kind: "file", path: csvPath(root) }]),
  ].join("\n");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The attachments folder a sent message uses where the recorded one has
 * `ATTACHMENTS`, so a fake can move recorded paths there; undefined when the
 * recording has none or the message doesn't match it.
 */
export const attachmentsRootIn = (recorded: string, sent: string): string | undefined => {
  if (!recorded.includes(ATTACHMENTS)) return undefined;
  const pattern = new RegExp(`^${recorded.split(ATTACHMENTS).map(escape).join("(/[^\"\\n]*?)")}$`, "s");
  const match = pattern.exec(sent);
  if (match === null) return undefined;
  const roots = new Set(match.slice(1));
  return roots.size === 1 ? [...roots][0] : undefined;
};
