import { Schema } from "effect";
export const ListNoteContextRequest = Schema.Struct({ vaultId: Schema.String, path: Schema.optionalKey(Schema.String) });
