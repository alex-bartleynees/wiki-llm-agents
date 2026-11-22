import { Schema } from "effect";

export const GetSkillRequest = Schema.Struct({ skillPath: Schema.String });
export type GetSkillRequest = typeof GetSkillRequest.Type;
