import { describe, expect, it } from "vitest";
import { describeInstant, describeRecurrence, isTimeZone, latestDue, localDate, nextSlot, zonedTime } from "./recurrence.js";

const AKL = "Pacific/Auckland";
const utc = (iso: string) => Date.parse(iso);

describe("zonedTime", () => {
  it("places a local time in the zone's offset", () => {
    // November: daylight time, UTC+13.
    expect(zonedTime("2026-11-13", "09:00", AKL)).toBe(utc("2026-11-12T20:00:00Z"));
    // June: standard time, UTC+12.
    expect(zonedTime("2026-06-15", "09:00", AKL)).toBe(utc("2026-06-14T21:00:00Z"));
  });

  it("moves a time in the daylight-saving gap forward by the gap", () => {
    // 27 Sep 2026: 02:00 NZST jumps to 03:00 NZDT, so 02:30 doesn't exist; it becomes 03:30 NZDT.
    expect(zonedTime("2026-09-27", "02:30", AKL)).toBe(utc("2026-09-26T14:30:00Z"));
    expect(zonedTime("2026-09-27", "03:30", AKL)).toBe(utc("2026-09-26T14:30:00Z"));
  });

  it("takes the first of a repeated time", () => {
    // 5 Apr 2026: 03:00 NZDT falls back to 02:00 NZST, so 02:30 happens twice.
    expect(zonedTime("2026-04-05", "02:30", AKL)).toBe(utc("2026-04-04T13:30:00Z"));
  });

  it("rejects a date that doesn't exist", () => {
    expect(zonedTime("2026-02-31", "09:00", AKL)).toBeNull();
  });
});

describe("nextSlot", () => {
  it("finds the next daily slot, strictly after", () => {
    const nine = utc("2026-11-12T20:00:00Z"); // 13 Nov 09:00 NZDT
    expect(nextSlot({ _tag: "daily", time: "09:00" }, AKL, nine - 1)).toBe(nine);
    expect(nextSlot({ _tag: "daily", time: "09:00" }, AKL, nine)).toBe(nine + 86_400_000);
  });

  it("fires a daily schedule once on the day a time repeats", () => {
    const daily = { _tag: "daily", time: "02:30" } as const;
    const first = nextSlot(daily, AKL, utc("2026-04-04T12:00:00Z"));
    expect(first).toBe(utc("2026-04-04T13:30:00Z"));
    // The second 02:30 (NZST) is skipped; the next is 6 April.
    expect(nextSlot(daily, AKL, first!)).toBe(utc("2026-04-05T14:30:00Z"));
  });

  it("fires a daily schedule at the shifted time on the day of the gap", () => {
    const daily = { _tag: "daily", time: "02:30" } as const;
    expect(nextSlot(daily, AKL, utc("2026-09-26T00:00:00Z"))).toBe(utc("2026-09-26T14:30:00Z"));
    // Next day back to 02:30 NZDT.
    expect(nextSlot(daily, AKL, utc("2026-09-26T14:30:00Z"))).toBe(utc("2026-09-27T13:30:00Z"));
  });

  it("finds the next weekly slot on the chosen days", () => {
    // Thu 12 Nov 2026, 10:00 NZDT; Mondays and Fridays at 08:30.
    const after = utc("2026-11-11T21:00:00Z");
    const weekly = { _tag: "weekly", days: [1, 5], time: "08:30" } as const;
    const friday = nextSlot(weekly, AKL, after);
    expect(friday).toBe(zonedTime("2026-11-13", "08:30", AKL));
    expect(nextSlot(weekly, AKL, friday!)).toBe(zonedTime("2026-11-16", "08:30", AKL));
  });

  it("fires a one-off once", () => {
    const once = { _tag: "once", date: "2026-11-13", time: "09:00" } as const;
    const at = utc("2026-11-12T20:00:00Z");
    expect(nextSlot(once, AKL, at - 1)).toBe(at);
    expect(nextSlot(once, AKL, at)).toBeNull();
  });
});

describe("latestDue", () => {
  it("folds missed slots into the latest", () => {
    const daily = { _tag: "daily", time: "09:00" } as const;
    const first = utc("2026-11-09T20:00:00Z"); // 10 Nov 09:00
    const now = utc("2026-11-12T21:00:00Z"); // 13 Nov 10:00
    expect(latestDue(daily, AKL, first, now)).toEqual({ latest: utc("2026-11-12T20:00:00Z"), coalesced: 3 });
  });

  it("returns the slot itself when it's the only one due", () => {
    const daily = { _tag: "daily", time: "09:00" } as const;
    const first = utc("2026-11-12T20:00:00Z");
    expect(latestDue(daily, AKL, first, first + 1000)).toEqual({ latest: first, coalesced: 0 });
  });

  it("jumps over years of missed slots", () => {
    const daily = { _tag: "daily", time: "09:00" } as const;
    const result = latestDue(daily, AKL, utc("2020-01-01T20:00:00Z"), utc("2026-11-12T21:00:00Z"));
    expect(result.latest).toBe(utc("2026-11-12T20:00:00Z"));
    expect(result.coalesced).toBeGreaterThan(0);
  });
});

describe("descriptions", () => {
  it("describes recurrences", () => {
    expect(describeRecurrence({ _tag: "daily", time: "09:00" })).toBe("Every day at 09:00");
    expect(describeRecurrence({ _tag: "weekly", days: [5, 1, 2, 3, 4], time: "08:00" })).toBe("Weekdays at 08:00");
    expect(describeRecurrence({ _tag: "weekly", days: [6, 7], time: "10:00" })).toBe("Weekends at 10:00");
    expect(describeRecurrence({ _tag: "weekly", days: [5, 1], time: "08:30" })).toBe("Every Mon, Fri at 08:30");
    expect(describeRecurrence({ _tag: "once", date: "2026-11-13", time: "09:00" })).toBe("Once on 2026-11-13 at 09:00");
  });

  it("describes an instant with its date, time and timezone", () => {
    const text = describeInstant(utc("2026-11-12T20:00:00Z"), AKL);
    expect(text).toBe("Fri 13 Nov 2026, 09:00 NZDT (Pacific/Auckland)");
  });

  it("knows local dates and timezones", () => {
    expect(localDate(utc("2026-11-12T20:00:00Z"), AKL)).toBe("2026-11-13");
    expect(isTimeZone(AKL)).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });
});
