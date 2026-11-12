import { IMAGE_EXTENSIONS } from "@wiki-agents/contracts/notes/upload-image/request";
import { formatDate } from "./templates.ts";

const EXTENSION_OF_TYPE: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

/** The images among pasted, dropped or chosen files (not SVG: the server refuses it). */
export const imageFiles = (files: Iterable<File> | null | undefined): ReadonlyArray<File> =>
  [...(files ?? [])].filter((file) => file.type in EXTENSION_OF_TYPE || IMAGE_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(`.${extension}`)));

/**
 * What to call an image in `assets/`. A pasted one is `Pasted image 20261113101500.png`,
 * as Obsidian names them (the clipboard's own name is always `image.png`); a dropped or
 * chosen one keeps its file name, with an extension from its type when it has none.
 */
export const imageName = (file: Pick<File, "name" | "type">, pasted: boolean, now: Date): string => {
  const typed = EXTENSION_OF_TYPE[file.type];
  if (pasted || file.name.trim() === "") return `Pasted image ${formatDate(now, "YYYYMMDDHHmmss")}.${typed ?? "png"}`;
  const hasExtension = IMAGE_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(`.${extension}`));
  return hasExtension || typed === undefined ? file.name : `${file.name}.${typed}`;
};
