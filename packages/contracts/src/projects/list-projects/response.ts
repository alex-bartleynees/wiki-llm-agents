import { Schema } from "effect";
import { Project } from "../model.js";

/** Every registered project, by name. */
export const ListProjectsResponse = Schema.Struct({ projects: Schema.Array(Project) });
export type ListProjectsResponse = typeof ListProjectsResponse.Type;
