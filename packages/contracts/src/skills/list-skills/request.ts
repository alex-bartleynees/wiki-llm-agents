import { Schema } from "effect";

export const ListSkillsRequest = Schema.Struct({ q: Schema.optional(Schema.String) });
export type ListSkillsRequest = typeof ListSkillsRequest.Type;
