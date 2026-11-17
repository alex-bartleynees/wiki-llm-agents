import { describe, expect, it } from "vitest";
import { dateFromExpiry, describeExpiry, expiryFromDate, isValidName } from "./secret-form.ts";

describe("isValidName", () => {
  it.each([
    ["github", true],
    ["coffee-journal-2", true],
    ["GitHub", false],
    ["-github", false],
    ["git hub", false],
    ["", false],
  ])("%j", (name, valid) => {
    expect(isValidName(name)).toBe(valid);
  });
});

describe("expiry dates", () => {
  it("takes the end of the picked day, local time, and gives the same day back", () => {
    const time = expiryFromDate("2027-03-05");
    expect(time).not.toBeNull();
    const date = new Date(time!);
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([2027, 2, 5, 23, 59]);
    expect(dateFromExpiry(time)).toBe("2027-03-05");
  });

  it("is null for no date", () => {
    expect(expiryFromDate("")).toBeNull();
    expect(expiryFromDate("not a date")).toBeNull();
    expect(dateFromExpiry(null)).toBe("");
  });

  it("warns in the last week and once expired", () => {
    const now = new Date(2027, 0, 10, 12).getTime();
    const day = 24 * 60 * 60 * 1000;
    expect(describeExpiry(null, now)).toBeNull();
    expect(describeExpiry(now + 30 * day, now)).toMatchObject({ text: expect.stringMatching(/^expires /), warn: false });
    expect(describeExpiry(now + 3 * day, now)).toMatchObject({ text: expect.stringMatching(/^expires /), warn: true });
    expect(describeExpiry(now - day, now)).toMatchObject({ text: expect.stringMatching(/^expired /), warn: true });
  });
});
