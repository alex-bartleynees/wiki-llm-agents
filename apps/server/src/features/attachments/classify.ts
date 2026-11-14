import { extname } from "node:path";
import { type Attachment, IMAGE_INPUT_TYPES, MAX_IMAGE_INPUT_BYTES } from "@wiki-agents/contracts/attachments/model";

/**
 * A safe file name: the last path segment, without control characters or characters
 * file systems refuse, no leading dots or spaces, at most 200 characters (keeping
 * the extension). Undefined when nothing is left.
 */
export const attachmentFileName = (name: string): string | undefined => {
  const cleaned = (name.replaceAll("\\", "/").split("/").pop() ?? "")
    .replace(/[:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/^[.\s]+/, "")
    .trim();
  if (cleaned === "") return undefined;
  if (cleaned.length <= 200) return cleaned;
  const extension = extname(cleaned).slice(0, 20);
  return cleaned.slice(0, 200 - extension.length) + extension;
};

/** The image type the bytes start with, whatever the name says; undefined for anything else. */
export const sniffImage = (bytes: Uint8Array): (typeof IMAGE_INPUT_TYPES)[number] | undefined => {
  const starts = (...signature: ReadonlyArray<number>) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return undefined;
};

/** Types for common extensions, so a download opens in the right program; others are octet-stream. */
const TYPES: Readonly<Record<string, string>> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  json: "application/json",
  jsonl: "application/x-ndjson",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  html: "text/html",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * What an upload is. An image by its bytes (PNG, JPEG, GIF or WebP) and up to
 * `MAX_IMAGE_INPUT_BYTES` reaches the model as an image; anything else, a larger
 * image or an SVG included, is a file the agent reads with its tools.
 */
export const classifyAttachment = (name: string, bytes: Uint8Array): Pick<Attachment, "mime" | "kind"> => {
  const image = sniffImage(bytes);
  if (image !== undefined) return { mime: image, kind: bytes.length <= MAX_IMAGE_INPUT_BYTES ? "image" : "file" };
  const extension = extname(name).slice(1).toLowerCase();
  const byName = TYPES[extension];
  // A name that claims an image the bytes aren't is no image.
  return { mime: byName === undefined || byName.startsWith("image/") ? "application/octet-stream" : byName, kind: "file" };
};
