import { Schema } from "effect";
export const NoteContextLink = Schema.Struct({ threadId: Schema.String, title: Schema.NullOr(Schema.String), turnId: Schema.String, path: Schema.String, reason: Schema.String, hash: Schema.String });
export type NoteContextLink = typeof NoteContextLink.Type;
export const ListNoteContextResponse = Schema.Struct({ notes: Schema.Array(NoteContextLink) });
