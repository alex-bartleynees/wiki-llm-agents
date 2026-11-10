import { Schema } from "effect";
import { Project } from "../model.js";

export const RegisterProjectResponse = Schema.Struct({ project: Project });
export type RegisterProjectResponse = typeof RegisterProjectResponse.Type;
