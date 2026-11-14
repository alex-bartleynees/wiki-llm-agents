import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppearanceStore, FONTS_KEY, THEME_KEY, type DarkPreference } from "./appearance.svelte.ts";

/** The appearance store with real Svelte state, applied to its own element; the device's dark setting is a stand-in. */

class FakePreference implements DarkPreference {
  #listeners: Array<(event: { matches: boolean }) => void> = [];
  constructor(public matches: boolean) {}
  addEventListener(_type: "change", listener: (event: { matches: boolean }) => void) {
    this.#listeners.push(listener);
  }
  set(matches: boolean) {
    this.matches = matches;
    for (const listener of this.#listeners) listener({ matches });
  }
}

let stores: Array<AppearanceStore> = [];
const store = (root: HTMLElement, preference = new FakePreference(false)) => {
  const created = new AppearanceStore(root, preference);
  stores.push(created);
  flushSync();
  return created;
};

beforeEach(() => {
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(FONTS_KEY);
});

afterEach(() => {
  for (const created of stores) created.stop();
  stores = [];
});

describe("theme", () => {
  it("follows the device setting until a theme is chosen", () => {
    const root = document.createElement("div");
    const preference = new FakePreference(true);
    const appearance = store(root, preference);
    expect(appearance.themeChoice).toBe("system");
    expect(root.dataset["theme"]).toBe("dark");

    preference.set(false);
    flushSync();
    expect(root.dataset["theme"]).toBe("light");

    appearance.setTheme("gruvbox-dark-hard");
    flushSync();
    expect(root.dataset["theme"]).toBe("gruvbox-dark-hard");
    preference.set(true);
    flushSync();
    expect(root.dataset["theme"]).toBe("gruvbox-dark-hard");
  });

  it("is remembered on this device", () => {
    store(document.createElement("div")).setTheme("gruvbox-dark-hard");
    expect(localStorage.getItem(THEME_KEY)).toBe("gruvbox-dark-hard");

    const root = document.createElement("div");
    const again = store(root);
    expect(again.themeChoice).toBe("gruvbox-dark-hard");
    expect(root.dataset["theme"]).toBe("gruvbox-dark-hard");
  });
});

describe("fonts", () => {
  it("overrides only the roles that aren't the default, and puts them back", () => {
    const root = document.createElement("div");
    const appearance = store(root);
    expect(root.style.getPropertyValue("--font-mono")).toBe("");

    appearance.setFont("mono", { kind: "custom", name: "JetBrains Mono" });
    appearance.setFont("ui", { kind: "system" });
    flushSync();
    expect(root.style.getPropertyValue("--font-mono")).toBe('"JetBrains Mono", ui-monospace, monospace');
    expect(root.style.getPropertyValue("--font-ui")).toBe("system-ui, sans-serif");
    expect(root.style.getPropertyValue("--font-read")).toBe("");

    appearance.setFont("mono", { kind: "default" });
    flushSync();
    expect(root.style.getPropertyValue("--font-mono")).toBe("");
  });

  it("stores the choices and the stacks app.html applies before first paint", () => {
    store(document.createElement("div")).setFont("read", { kind: "custom", name: "Literata" });
    expect(JSON.parse(localStorage.getItem(FONTS_KEY) ?? "null")).toEqual({
      choices: { ui: { kind: "default" }, mono: { kind: "default" }, read: { kind: "custom", name: "Literata" } },
      stacks: { "--font-read": '"Literata", ui-serif, serif' },
    });

    const root = document.createElement("div");
    const again = store(root);
    expect(again.fonts.read).toEqual({ kind: "custom", name: "Literata" });
    expect(root.style.getPropertyValue("--font-read")).toBe('"Literata", ui-serif, serif');
  });
});
