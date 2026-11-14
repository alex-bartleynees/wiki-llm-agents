import { formatSize, IMAGE_INPUT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@wiki-agents/contracts/attachments/model";
import type { ProviderModel } from "@wiki-agents/contracts/providers/model";
import { imageName } from "#lib/features/notes/images.ts";

/** Shown as a thumbnail while it uploads; the server decides what goes as an image. */
export const looksLikeImage = (file: Pick<File, "type">) => (IMAGE_INPUT_TYPES as ReadonlyArray<string>).includes(file.type);

/**
 * What to call an attachment. A pasted image is `Pasted image 20261115101500.png`, as
 * in the editor (the clipboard calls every one `image.png`); anything else keeps its
 * own name, or `Pasted file` when it has none.
 */
export const attachmentName = (file: Pick<File, "name" | "type">, pasted: boolean, now: Date): string => {
  if (looksLikeImage(file)) return imageName(file, pasted, now);
  return file.name.trim() === "" ? "Pasted file" : file.name;
};

/**
 * The files to upload of those added, given how many the message already has, and
 * why any were left out: too large, or past the limit per message.
 */
export const admit = (files: ReadonlyArray<File>, already: number): { readonly accepted: ReadonlyArray<File>; readonly refused: string | null } => {
  const reasons: Array<string> = [];
  const fitting = files.filter((file) => {
    if (file.size <= MAX_ATTACHMENT_BYTES) return true;
    reasons.push(`${file.name || "A file"} is over ${formatSize(MAX_ATTACHMENT_BYTES)}`);
    return false;
  });
  const room = Math.max(0, MAX_ATTACHMENTS - already);
  if (fitting.length > room) reasons.push(`a message takes up to ${MAX_ATTACHMENTS} files`);
  return { accepted: fitting.slice(0, room), refused: reasons.length === 0 ? null : `Not attached: ${reasons.join("; ")}.` };
};

/**
 * The thread's model, when it is known not to take images: the composer then offers to
 * send them as files. Null when it takes images, or isn't known (taken to).
 */
export const modelWithoutImages = (models: ReadonlyArray<ProviderModel>, current: string | null): ProviderModel | null => {
  const model = models.find((candidate) => candidate.id === current);
  return model !== undefined && !model.images ? model : null;
};
