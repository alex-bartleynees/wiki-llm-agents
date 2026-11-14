import type { Attachment } from "@wiki-agents/contracts/attachments/model";
import { Context, Data, type Effect } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";

export class InvalidAttachment extends Data.TaggedError("InvalidAttachment")<{ readonly reason: string }> {}

/** The bytes couldn't be written to the data folder. */
export class AttachmentStorageError extends Data.TaggedError("AttachmentStorageError")<{ readonly cause: unknown }> {}

export class AttachmentNotFound extends Data.TaggedError("AttachmentNotFound")<{ readonly attachmentId: string }> {}

/** An attachment and where its bytes are. */
export interface StoredAttachment extends Attachment {
  /** Absolute path of the file, for providers and for serving it. */
  readonly path: string;
}

/**
 * Message attachments, kept in the app's data folder rather than a vault: a chat
 * screenshot or a log export doesn't belong to a note, and may hold data that
 * shouldn't be synced or backed up with the vault. The port threads use to turn a
 * message's attachment ids into files.
 */
export interface AttachmentStoreService {
  /** The folder the files are kept in (`<data dir>/attachments`). */
  readonly root: string;
  /** Keeps the bytes under the name; the same bytes and name give back the same attachment. */
  readonly save: (name: string, bytes: Uint8Array) => Effect.Effect<StoredAttachment, InvalidAttachment | AttachmentStorageError | DbError>;
  /** The attachments with these ids, in the same order; fails on the first unknown id. */
  readonly find: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<StoredAttachment>, AttachmentNotFound | DbError>;
}

export class AttachmentStore extends Context.Service<AttachmentStore, AttachmentStoreService>()("AttachmentStore") {}
