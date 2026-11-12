import { Schema } from "effect";

/** 201: where the image went. */
export const UploadImageResponse = Schema.Struct({
  /** Vault-relative, e.g. `assets/Pasted image 20261113101500.png`. */
  path: Schema.String,
});
export type UploadImageResponse = typeof UploadImageResponse.Type;
