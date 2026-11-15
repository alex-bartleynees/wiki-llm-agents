import { Schema } from "effect";

/** Unsent message text, shared by browsers. Version changes on every accepted write. */
export const ThreadDraft = Schema.Struct({ text: Schema.String, version: Schema.Number });
export type ThreadDraft = typeof ThreadDraft.Type;
