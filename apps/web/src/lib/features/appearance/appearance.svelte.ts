import { DEFAULT_FONTS, FONT_ROLES, fontStacks, parseFontChoices, type FontChoice, type FontChoices, type FontRole } from "./fonts.ts";
import { parseThemeChoice, resolveTheme, type ThemeChoice } from "./themes.ts";

/**
 * Also read by the inline script in src/app.html, which applies both before first
 * paint: the theme key holds a `ThemeChoice`, the fonts key `{ choices, stacks }`.
 */
export const THEME_KEY = "wiki-agents:theme";
export const FONTS_KEY = "wiki-agents:fonts";

/** The part of `MediaQueryList` the store uses, so tests can stand in for the device setting. */
export interface DarkPreference {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { readonly matches: boolean }) => void): void;
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or full storage: the choice just won't be remembered.
  }
};

const storedFonts = (): FontChoices => {
  try {
    return parseFontChoices((JSON.parse(read(FONTS_KEY) ?? "{}") as { choices?: unknown }).choices);
  } catch {
    return DEFAULT_FONTS;
  }
};

/** The colour theme and fonts chosen on this device, applied to `root` (<html>). */
export class AppearanceStore {
  themeChoice = $state<ThemeChoice>(parseThemeChoice(read(THEME_KEY)));
  fonts = $state<FontChoices>(storedFonts());
  #prefersDark = $state(false);
  /** The theme on screen: the choice, or Light or Dark for "system". */
  readonly theme = $derived(resolveTheme(this.themeChoice, this.#prefersDark));
  readonly stop: () => void;

  constructor(root: HTMLElement = document.documentElement, preference: DarkPreference = matchMedia("(prefers-color-scheme: dark)")) {
    this.#prefersDark = preference.matches;
    preference.addEventListener("change", (event) => (this.#prefersDark = event.matches));
    this.stop = $effect.root(() => {
      $effect(() => {
        root.dataset["theme"] = this.theme;
        // The browser's own bars (and an installed app's title bar) match the header.
        const surface = getComputedStyle(root).getPropertyValue("--surface").trim();
        const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        if (meta !== null && surface !== "") meta.content = surface;
      });
      $effect(() => {
        const stacks = fontStacks(this.fonts);
        for (const { token } of FONT_ROLES) {
          const stack = stacks[token];
          if (stack === undefined) root.style.removeProperty(token);
          else root.style.setProperty(token, stack);
        }
      });
    });
  }

  setTheme(choice: ThemeChoice) {
    this.themeChoice = choice;
    write(THEME_KEY, choice);
  }

  setFont(role: FontRole, choice: FontChoice) {
    this.fonts = { ...this.fonts, [role]: choice };
    write(FONTS_KEY, JSON.stringify({ choices: this.fonts, stacks: fontStacks(this.fonts) }));
  }
}

export const appearance = new AppearanceStore();
