import { Schema } from "effect";
import { ThreadDraft } from "../draft.js";

export const GetDraftResponse = Schema.Struct({ draft: ThreadDraft });
export type GetDraftResponse = typeof GetDraftResponse.Type;
