import { Schema } from "effect";
import { Project } from "../model.js";

export const RemoveWorkingDirectoryResponse = Schema.Struct({ project: Project });
export type RemoveWorkingDirectoryResponse = typeof RemoveWorkingDirectoryResponse.Type;
