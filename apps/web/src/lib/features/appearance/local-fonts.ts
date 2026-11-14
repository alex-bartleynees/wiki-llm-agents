/** Only metadata is needed; font files and the installed-font list stay on this device. */
type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<ReadonlyArray<{ readonly family: string }>>;
};

export const canListLocalFonts = () => window.isSecureContext && typeof (window as LocalFontWindow).queryLocalFonts === "function";

/** Call directly from a user gesture so the browser can request permission. */
export const listLocalFontFamilies = async (): Promise<string[]> => {
  const fonts = await (window as LocalFontWindow).queryLocalFonts!();
  return [...new Set(fonts.map((font) => font.family).filter((family) => family.trim() !== ""))]
    .sort((a, b) => a.localeCompare(b));
};
