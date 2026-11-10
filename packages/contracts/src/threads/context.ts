import { Schema } from "effect";
export const NoteReference = Schema.Struct({ path: Schema.String.check(Schema.isNonEmpty()), selection: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16000))) });
export const ContextNote = Schema.Struct({ path: Schema.String, heading: Schema.NullOr(Schema.String), reason: Schema.Literals(["supplied", "retrieved", "cited"]), hash: Schema.String, content: Schema.String, notices: Schema.Array(Schema.String) });
export type ContextNote = typeof ContextNote.Type;
export const NoteContext = Schema.TaggedStruct("note.context", { turnId: Schema.String, note: ContextNote });
