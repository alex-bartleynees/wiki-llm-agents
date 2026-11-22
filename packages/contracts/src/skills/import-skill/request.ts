import { Schema } from "effect";

export const ImportSkillRequest = Schema.Struct({ path: Schema.String });
export type ImportSkillRequest = typeof ImportSkillRequest.Type;
