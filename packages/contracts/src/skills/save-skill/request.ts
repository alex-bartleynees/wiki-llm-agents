import { Schema } from "effect";
import { NullableHash } from "../model.js";

export const SaveSkillRequest = Schema.Struct({ skillPath: Schema.String, content: Schema.String, baseHash: NullableHash });
export type SaveSkillRequest = typeof SaveSkillRequest.Type;
