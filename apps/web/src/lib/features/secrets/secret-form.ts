import { describeSecretUses, type KeySource, type SecretSummary } from "@wiki-agents/contracts/secrets/model";

/** As the server checks it: lowercase letters, digits and hyphens, as in `${secret:<name>}`. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const isValidName = (name: string) => NAME_PATTERN.test(name);

/** What each key source protects against, for Settings. */
export const KEY_SOURCE_LABELS: Readonly<Record<KeySource, string>> = {
  "systemd-creds": "Their key is encrypted by systemd for you on this machine, so a copy of the app's data opens nothing elsewhere.",
  file: "Their key is a file only you can read, outside the app's data, so a copy of the data alone opens nothing.",
};

/** An `<input type="date">` value as the end of that day, local time; null when empty. */
export const expiryFromDate = (value: string): number | null => {
  if (value === "") return null;
  const time = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isNaN(time) ? null : time;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The other way round, for editing: the local date of `time`, or empty. */
export const dateFromExpiry = (time: number | null): string => {
  if (time === null) return "";
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a token stops working, as Settings says it: soon-to-expire and expired ones stand out. */
export const describeExpiry = (expiresAt: number | null, now: number): { readonly text: string; readonly warn: boolean } | null => {
  if (expiresAt === null) return null;
  const day = new Date(expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (expiresAt <= now) return { text: `expired ${day}`, warn: true };
  return { text: `expires ${day}`, warn: expiresAt - now < 7 * DAY_MS };
};

/** What uses it: servers by id, then projects' browser sign-ins. */
export const usesOf = (secret: SecretSummary) => describeSecretUses(secret.usedBy, secret.usedBySignIns);

/** Which servers and browser sign-ins use it, or that none do. */
export const describeUse = (secret: SecretSummary) => {
  const uses = usesOf(secret);
  return uses.length === 0 ? "not used yet" : `used by ${uses.join(", ")}`;
};
