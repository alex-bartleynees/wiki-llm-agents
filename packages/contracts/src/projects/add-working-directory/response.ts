import { Schema } from "effect";
import { Project } from "../model.js";

export const AddWorkingDirectoryResponse = Schema.Struct({ project: Project });
export type AddWorkingDirectoryResponse = typeof AddWorkingDirectoryResponse.Type;
