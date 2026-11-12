import { describe, expect, it } from "vitest";
import { foldersOf, formatDate, newNotePath, noteFileName, renderTemplate, templatesIn } from "./templates.ts";

// Local time, as templates use the device's clock.
const now = new Date(2026, 10, 3, 9, 5, 7);

describe("templatesIn", () => {
  it("lists the notes in the folder and its subfolders, by name", () => {
    const paths = ["Templates/Meeting.md", "Templates/Daily/Day.md", "Templates/logo.png", "Templatesque.md", "Notes/A.md"];
    expect(templatesIn(paths, "Templates")).toEqual([
      { path: "Templates/Daily/Day.md", name: "Daily/Day" },
      { path: "Templates/Meeting.md", name: "Meeting" },
    ]);
    expect(templatesIn(paths, null)).toEqual([]);
  });
});

describe("formatDate", () => {
  it("formats moment.js tokens and keeps [literal] text", () => {
    expect(formatDate(now, "YYYY-MM-DD")).toBe("2026-11-03");
    expect(formatDate(now, "dddd, D MMMM YY")).toBe("Tuesday, 3 November 26");
    expect(formatDate(now, "ddd MMM h:mm A")).toBe("Tue Nov 9:05 AM");
    expect(formatDate(new Date(2026, 0, 1, 0, 0, 0), "hh a")).toBe("12 am");
    expect(formatDate(now, "HH:mm:ss [at] [YYYY]")).toBe("09:05:07 at YYYY");
  });
});

describe("renderTemplate", () => {
  it("fills in title, date and time, with or without a format", () => {
    const template = "---\ncreated: {{date}} {{time}}\n---\n# {{title}}\n\n{{date:dddd D MMMM}} · {{ time:h:mm a }} · {{other}}\n";
    expect(renderTemplate(template, { title: "Standup", now })).toBe(
      "---\ncreated: 2026-11-03 09:05\n---\n# Standup\n\nTuesday 3 November · 9:05 am · {{other}}\n",
    );
  });
});

describe("noteFileName", () => {
  it("drops characters a file name or wikilink can't hold", () => {
    expect(noteFileName("  Tea: a #history [of] leaves?  ")).toBe("Tea a history of leaves.md");
    expect(noteFileName("Already.md")).toBe("Already.md");
    expect(noteFileName("../../etc")).toBe("etc.md");
    expect(noteFileName(" ?# ")).toBeUndefined();
  });

  it("puts the note in its folder", () => {
    expect(newNotePath("", "Tea.md")).toBe("Tea.md");
    expect(newNotePath("Drinks/Hot", "Tea.md")).toBe("Drinks/Hot/Tea.md");
  });
});

describe("foldersOf", () => {
  it("lists the top and every folder on the way to a file", () => {
    expect(foldersOf(["a/b/c.md", "a/d.md", "e.md", "f/g.png"])).toEqual(["", "a", "a/b", "f"]);
  });
});
