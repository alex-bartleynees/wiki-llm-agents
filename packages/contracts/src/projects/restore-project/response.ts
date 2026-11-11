import { Schema } from "effect";
import { Project } from "../model.js";

export const RestoreProjectResponse = Schema.Struct({ project: Project });
export type RestoreProjectResponse = typeof RestoreProjectResponse.Type;
