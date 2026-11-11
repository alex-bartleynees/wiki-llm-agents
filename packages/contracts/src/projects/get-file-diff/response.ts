import { Schema } from "effect";
import { DiffFile } from "../model.js";

export const GetFileDiffResponse = Schema.Struct({ file: DiffFile });
export type GetFileDiffResponse = typeof GetFileDiffResponse.Type;
