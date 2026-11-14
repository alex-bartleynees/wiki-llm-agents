import { quoted } from "./fonts.ts";

const SAMPLE = "mmmmmmmmmmlli1WQ@#&wiki-agents 0O";
const FALLBACKS = ["monospace", "sans-serif"] as const;

let context: CanvasRenderingContext2D | null | undefined;

const width = (font: string) => {
  context ??= document.createElement("canvas").getContext("2d");
  if (context === null) return null;
  context.font = `48px ${font}`;
  return context.measureText(SAMPLE).width;
};

/**
 * Whether this device can draw a font by family name: true when installed (or loaded
 * as a web font), false when missing, null when it can't tell. Browsers don't list
 * local fonts (short of the Local Font Access API, which asks permission), so this
 * measures text in the named font against two generic fallbacks: a missing font falls
 * back and measures exactly like the fallback both times. Two fallbacks catch a font
 * that happens to be the device's monospace or sans-serif default.
 */
export const fontAvailable = (name: string): boolean | null => {
  for (const fallback of FALLBACKS) {
    const plain = width(fallback);
    const named = width(`${quoted(name)}, ${fallback}`);
    if (plain === null || named === null) return null;
    if (plain !== named) return true;
  }
  return false;
};
