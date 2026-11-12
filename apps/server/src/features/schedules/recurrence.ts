import type { Recurrence } from "@wiki-agents/contracts/schedules/model";

/**
 * Local times in IANA timezones, without a date library: `Intl` knows every zone's
 * offsets. Pure, so the daylight-saving rules are tested on their own.
 *
 * Policy, as Temporal's "compatible" disambiguation:
 * - a local time that doesn't exist that day (the hour skipped when daylight saving
 *   starts) is moved forward by the length of the gap: 02:30 becomes 03:30;
 * - a local time that happens twice (the hour repeated when it ends) is the first
 *   one, so the schedule fires once.
 */

const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatter = (timeZone: string) => {
  let format = formatters.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  return format;
};

/** Whether `Intl` knows the timezone (an IANA name such as `Pacific/Auckland`). */
export const isTimeZone = (timeZone: string) => {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
};

interface Wall {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** The wall clock in `timeZone` at `ms`. */
const wall = (ms: number, timeZone: string): Wall => {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(ms)) if (part.type !== "literal") parts[part.type] = Number(part.value);
  return { year: parts["year"]!, month: parts["month"]!, day: parts["day"]!, hour: parts["hour"]!, minute: parts["minute"]!, second: parts["second"]! };
};

const wallAsUtc = (time: Wall) => Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);

/** The zone's offset from UTC at `ms`, in milliseconds (Auckland in summer: +13 h). */
const offsetAt = (ms: number, timeZone: string) => wallAsUtc(wall(Math.floor(ms / 1000) * 1000, timeZone)) - Math.floor(ms / 1000) * 1000;

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` of `ms` in `timeZone`. */
export const localDate = (ms: number, timeZone: string) => {
  const time = wall(ms, timeZone);
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
};

const parseDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
};

/** `date` plus `days`, as `YYYY-MM-DD`. */
const addDays = (date: string, days: number) => {
  const { year, month, day } = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};

/** ISO weekday of a date: 1 Monday … 7 Sunday. */
const weekday = (date: string) => {
  const { year, month, day } = parseDate(date);
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
};

/**
 * The instant of `time` on `date` in `timeZone`, following the policy above. A
 * calendar date that doesn't exist (31 February) gives null.
 */
export const zonedTime = (date: string, time: string, timeZone: string): number | null => {
  const { year, month, day } = parseDate(date);
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(local);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  // Offsets either side of any transition that day; a zone changes offset at most once a day.
  const before = offsetAt(local - DAY, timeZone);
  const after = offsetAt(local + DAY, timeZone);
  const candidates = [...new Set([local - before, local - after])]
    .filter((instant) => wallAsUtc(wall(instant, timeZone)) === local)
    .sort((a, b) => a - b);
  // Repeated time: the first. Skipped time: shifted forward by the gap (the offset before it applies).
  return candidates[0] ?? local - before;
};

/** Enough days ahead to find a weekly slot even when a gap shifts one. */
const LOOKAHEAD_DAYS = 9;

/** The first time the recurrence fires strictly after `after`; null when it never will (a one-off in the past). */
export const nextSlot = (recurrence: Recurrence, timeZone: string, after: number): number | null => {
  if (recurrence._tag === "once") {
    const at = zonedTime(recurrence.date, recurrence.time, timeZone);
    return at !== null && at > after ? at : null;
  }
  // Start a day early: a slot late yesterday in local time can still be ahead in UTC terms.
  const start = addDays(localDate(after, timeZone), -1);
  for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset++) {
    const date = addDays(start, offset);
    if (recurrence._tag === "weekly" && !recurrence.days.includes(weekday(date))) continue;
    const at = zonedTime(date, recurrence.time, timeZone);
    if (at !== null && at > after) return at;
  }
  return null;
};

/** How many slots to step through at most when catching up; past that, the latest is found by jumping. */
const MAX_STEPS = 1000;

/**
 * Due slots from `first` (itself due) up to `now`: the latest, and how many earlier
 * ones it stands for. Slots missed while the app was off are folded into one.
 */
export const latestDue = (recurrence: Recurrence, timeZone: string, first: number, now: number) => {
  let latest = first;
  let coalesced = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const next = nextSlot(recurrence, timeZone, latest);
    if (next === null || next > now) return { latest, coalesced };
    latest = next;
    coalesced++;
  }
  // Years of daily slots: jump to the last day before now, then step.
  let jumped = nextSlot(recurrence, timeZone, now - 8 * DAY) ?? latest;
  for (let next = nextSlot(recurrence, timeZone, jumped); next !== null && next <= now; next = nextSlot(recurrence, timeZone, jumped)) jumped = next;
  return { latest: Math.max(latest, jumped), coalesced: coalesced + 1 };
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Every day at 09:00", "Mondays and Fridays at 08:30", "Once on 2026-11-13 at 09:00". */
export const describeRecurrence = (recurrence: Recurrence) => {
  switch (recurrence._tag) {
    case "once":
      return `Once on ${recurrence.date} at ${recurrence.time}`;
    case "daily":
      return `Every day at ${recurrence.time}`;
    case "weekly": {
      const days = [...recurrence.days].sort((a, b) => a - b);
      if (days.length === 7) return `Every day at ${recurrence.time}`;
      if (days.join() === "1,2,3,4,5") return `Weekdays at ${recurrence.time}`;
      if (days.join() === "6,7") return `Weekends at ${recurrence.time}`;
      return `Every ${days.map((day) => DAY_NAMES[day - 1]).join(", ")} at ${recurrence.time}`;
    }
  }
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const zoneNames = new Map<string, Intl.DateTimeFormat>();

/** The zone's short name at `ms` ("NZDT"), or its offset where it has none ("GMT+13"). */
const zoneName = (ms: number, timeZone: string) => {
  let format = zoneNames.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-NZ", { timeZone, timeZoneName: "short" });
    zoneNames.set(timeZone, format);
  }
  return format.formatToParts(ms).find((part) => part.type === "timeZoneName")?.value ?? timeZone;
};

/** "Fri 13 Nov 2026, 09:00 NZDT (Pacific/Auckland)": a concrete local date, time and timezone. */
export const describeInstant = (ms: number, timeZone: string) => {
  const time = wall(ms, timeZone);
  const date = `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  return `${DAY_NAMES[weekday(date) - 1]} ${time.day} ${MONTH_NAMES[time.month - 1]} ${time.year}, ${pad(time.hour)}:${pad(time.minute)} ${zoneName(ms, timeZone)} (${timeZone})`;
};
