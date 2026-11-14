/**
 * Font choices per role. Each role is a token in `ui/tokens.css` whose default is a
 * font the app bundles; a choice other than the default overrides the token with an
 * inline style on <html>.
 */
export const FONT_ROLES = [
  { role: "ui", token: "--font-ui", label: "Interface", bundled: "IBM Plex Sans", system: "system-ui, sans-serif" },
  { role: "mono", token: "--font-mono", label: "Code", bundled: "IBM Plex Mono", system: "ui-monospace, monospace" },
  { role: "read", token: "--font-read", label: "Reading", bundled: "Source Serif 4", system: "ui-serif, serif" },
] as const;

export type FontRole = (typeof FONT_ROLES)[number]["role"];
export type FontToken = (typeof FONT_ROLES)[number]["token"];

/**
 * - default: the bundled font, the same on every device.
 * - system: the device's own fonts (on NixOS, fontconfig's, which Stylix sets).
 * - custom: any font installed on the device, by name, falling back to the system font.
 */
export type FontChoice = { readonly kind: "default" } | { readonly kind: "system" } | { readonly kind: "custom"; readonly name: string };

export type FontChoices = Readonly<Record<FontRole, FontChoice>>;

export const DEFAULT_FONTS: FontChoices = { ui: { kind: "default" }, mono: { kind: "default" }, read: { kind: "default" } };

/** Long enough for any real family name. */
const MAX_NAME = 100;

/** A typed font name with control characters removed, trimmed and capped. */
export const cleanFontName = (name: string) =>
  name
    .replace(/[\p{Cc}]/gu, "")
    .trim()
    .slice(0, MAX_NAME);

const parseChoice = (value: unknown): FontChoice => {
  if (typeof value !== "object" || value === null) return { kind: "default" };
  const { kind, name } = value as { kind?: unknown; name?: unknown };
  if (kind === "system") return { kind: "system" };
  if (kind === "custom" && typeof name === "string") return { kind: "custom", name: name.slice(0, MAX_NAME) };
  return { kind: "default" };
};

/** Stored choices, with the default for any role missing or malformed. */
export const parseFontChoices = (value: unknown): FontChoices => {
  const stored = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return { ui: parseChoice(stored["ui"]), mono: parseChoice(stored["mono"]), read: parseChoice(stored["read"]) };
};

/** A CSS string, so any family name is safe in `font-family`. */
export const quoted = (name: string) => `"${name.replace(/["\\]/g, "\\$&")}"`;

/**
 * The `font-family` value for a role's token, or null to keep the token's default. A
 * custom choice with no name yet uses the system font.
 */
export const fontStack = (role: FontRole, choice: FontChoice): string | null => {
  const { system } = FONT_ROLES.find((font) => font.role === role)!;
  if (choice.kind === "default") return null;
  const name = choice.kind === "custom" ? cleanFontName(choice.name) : "";
  return name === "" ? system : `${quoted(name)}, ${system}`;
};

/** The tokens to override: what the store applies, and what `src/app.html` applies before first paint. */
export const fontStacks = (choices: FontChoices): Partial<Record<FontToken, string>> => {
  const stacks: Partial<Record<FontToken, string>> = {};
  for (const { role, token } of FONT_ROLES) {
    const stack = fontStack(role, choices[role]);
    if (stack !== null) stacks[token] = stack;
  }
  return stacks;
};
