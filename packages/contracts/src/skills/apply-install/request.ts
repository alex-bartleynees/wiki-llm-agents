import { Schema } from "effect";
import { InstallAction } from "../model.js";

export const ApplyInstallRequest = Schema.Struct({ skillPath: Schema.String, destination: Schema.String, action: InstallAction, token: Schema.String });
export type ApplyInstallRequest = typeof ApplyInstallRequest.Type;
