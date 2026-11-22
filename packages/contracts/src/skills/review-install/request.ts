import { Schema } from "effect";
import { InstallAction } from "../model.js";

export const ReviewInstallRequest = Schema.Struct({ skillPath: Schema.String, destination: Schema.String, action: InstallAction });
export type ReviewInstallRequest = typeof ReviewInstallRequest.Type;
