import { Schema } from "effect";

/** Images the editor can add to a vault; SVG is left out, as it can carry scripts. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"] as const;

/** Largest image accepted, in bytes. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/vaults/:vaultId/assets?name=… with the image's bytes as the body: adds an
 * image to the vault's `assets/` folder, under `name` or, when that's taken, `name 1`…
 */
export const UploadImageRequest = Schema.Struct({
  vaultId: Schema.String,
  /** A file name with an image extension (`Pasted image 20261113101500.png`). */
  name: Schema.String.check(Schema.isNonEmpty()),
});
export type UploadImageRequest = typeof UploadImageRequest.Type;
