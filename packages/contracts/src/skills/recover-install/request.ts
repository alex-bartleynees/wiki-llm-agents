import { Schema } from "effect";

export const RecoverInstallRequest = Schema.Struct({ skillPath: Schema.String, destination: Schema.String });
export type RecoverInstallRequest = typeof RecoverInstallRequest.Type;
