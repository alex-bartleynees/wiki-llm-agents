/**
 * The colour themes. Their colours are tokens in `ui/tokens.css`, one
 * `:root[data-theme=…]` block each; the inline script in `src/app.html` repeats the ids
 * and backgrounds for the first paint (`themes.test.ts` checks they match).
 */
export const THEMES = [
  { id: "light", label: "Light", scheme: "light" },
  { id: "dark", label: "Dark", scheme: "dark" },
  { id: "gruvbox-dark-hard", label: "Gruvbox Dark Hard", scheme: "dark" },
  { id: "tokyo-night", label: "Tokyo Night", scheme: "dark" },
  { id: "everforest", label: "Everforest", scheme: "dark" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", scheme: "dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** "system" follows the device's light or dark setting between Light and Dark. */
export type ThemeChoice = "system" | ThemeId;

const CHOICES: ReadonlyArray<string> = ["system", ...THEMES.map((theme) => theme.id)];

/** A stored choice, or "system" for anything missing or unknown. */
export const parseThemeChoice = (value: unknown): ThemeChoice =>
  typeof value === "string" && CHOICES.includes(value) ? (value as ThemeChoice) : "system";

export const resolveTheme = (choice: ThemeChoice, prefersDark: boolean): ThemeId =>
  choice === "system" ? (prefersDark ? "dark" : "light") : choice;
