import { Schema } from "effect";
import { Project } from "../model.js";

export const ArchiveProjectResponse = Schema.Struct({ project: Project });
export type ArchiveProjectResponse = typeof ArchiveProjectResponse.Type;
