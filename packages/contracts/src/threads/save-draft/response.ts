import { Schema } from "effect";
import { ThreadDraft } from "../draft.js";

export const SaveDraftResponse = Schema.Struct({ draft: ThreadDraft });
export type SaveDraftResponse = typeof SaveDraftResponse.Type;
