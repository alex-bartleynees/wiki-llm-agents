import type { Attachment } from "@wiki-agents/contracts/attachments/model";
import { errorMessage } from "#lib/api/client.ts";
import { uploadAttachment } from "./api.ts";
import { admit, attachmentName, looksLikeImage } from "./draft.ts";

/** A file added to the message being written: uploading, kept, or failed. */
export interface DraftAttachment {
  readonly key: number;
  readonly name: string;
  readonly size: number;
  /** An object URL of the file, for an image's thumbnail before it is sent. */
  readonly preview: string | null;
  status: "uploading" | "ready" | "failed";
  /** The kept file, once uploaded; its `kind` says whether it goes as an image. */
  attachment: Attachment | null;
  error: string | null;
}

let nextKey = 0;

/**
 * The files attached to the message being written. Each uploads as soon as it is
 * added, so sending only names their ids. One per composer.
 */
export class AttachmentDraft {
  items = $state<Array<DraftAttachment>>([]);
  /** Why files were just left out (too large, too many); cleared by the next change. */
  refused = $state<string | null>(null);

  readonly uploading = $derived(this.items.some((item) => item.status === "uploading"));
  readonly failed = $derived(this.items.some((item) => item.status === "failed"));
  /** The kept files, in the order they were added. */
  readonly ready = $derived(this.items.flatMap((item) => (item.status === "ready" && item.attachment !== null ? [item.attachment] : [])));
  /** Any of them goes to the model as an image. */
  readonly hasImages = $derived(this.ready.some((attachment) => attachment.kind === "image"));

  /** Adds pasted, dropped or chosen files, up to the limits, and uploads each. */
  add(files: Iterable<File>, pasted = false) {
    const { accepted, refused } = admit([...files], this.items.length);
    this.refused = refused;
    const now = new Date();
    for (const file of accepted) {
      const item: DraftAttachment = {
        key: nextKey++,
        name: attachmentName(file, pasted, now),
        size: file.size,
        preview: looksLikeImage(file) ? URL.createObjectURL(file) : null,
        status: "uploading",
        attachment: null,
        error: null,
      };
      this.items.push(item);
      void this.#upload(item.key, item.name, file);
    }
  }

  async #upload(key: number, name: string, file: File) {
    try {
      const attachment = await uploadAttachment(name, file);
      const item = this.#find(key);
      if (item === undefined) return;
      item.attachment = attachment;
      item.status = "ready";
    } catch (error) {
      const item = this.#find(key);
      if (item === undefined) return;
      item.error = errorMessage(error, "Couldn't upload it");
      item.status = "failed";
    }
  }

  /** The item as stored in state, so changes to it show; undefined once removed. */
  #find(key: number) {
    return this.items.find((item) => item.key === key);
  }

  remove(key: number) {
    const item = this.#find(key);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    this.items = this.items.filter((other) => other.key !== key);
    this.refused = null;
  }

  /** After sending, or when the composer goes away. */
  clear() {
    for (const item of this.items) if (item.preview) URL.revokeObjectURL(item.preview);
    this.items = [];
    this.refused = null;
  }
}
