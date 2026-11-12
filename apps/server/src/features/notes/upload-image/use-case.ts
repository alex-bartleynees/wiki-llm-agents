import { randomBytes } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, type UploadImageRequest } from "@wiki-agents/contracts/notes/upload-image/request";
import type { UploadImageResponse } from "@wiki-agents/contracts/notes/upload-image/response";
import { Data, Effect, FileSystem } from "effect";
import { resolveNewInVault } from "../../../shared/vault/path-guard.js";
import { Indexer } from "../../indexing/indexer.js";
import { findVault } from "../../vaults/find-vault.js";

/** Where images go, as in Obsidian's "Files and links" setting. */
export const ASSETS_FOLDER = "assets";

export class InvalidImage extends Data.TaggedError("InvalidImage")<{ readonly reason: string }> {}

/**
 * A safe file name: no folders, and none of the characters that break a wikilink
 * (`# ^ [ ] |`) or a file system (`\ / : * ? " < > `), at most 120 characters.
 */
export const imageFileName = (name: string): string | undefined => {
  const cleaned = basename(name.replaceAll("\\", "/"))
    .replace(/[#^[\]|\\/:*?"<>\u0000-\u001f]/g, "-")
    .replace(/^[.\s]+/, "")
    .trim();
  const extension = extname(cleaned).slice(1).toLowerCase();
  if (!(IMAGE_EXTENSIONS as ReadonlyArray<string>).includes(extension)) return undefined;
  const stem = cleaned.slice(0, -(extension.length + 1)).trim().slice(0, 120 - extension.length - 1);
  return stem === "" ? undefined : `${stem}.${extension}`;
};

/** `name.png`, then `name 1.png`, `name 2.png`… */
const candidate = (name: string, attempt: number) => {
  if (attempt === 0) return name;
  const extension = extname(name);
  return `${name.slice(0, -extension.length)} ${attempt}${extension}`;
};

/**
 * Adds an image to `assets/`, never replacing a file: the bytes go to a hidden
 * temporary file that is hard-linked to the first free name (a link fails if the
 * name is taken, so two uploads can't race for it) and then removed. Indexed before
 * answering, so the tree and `![[…]]` embeds see it straight away.
 */
export const uploadImage = Effect.fn("uploadImage")(function* (request: UploadImageRequest & { readonly bytes: Uint8Array }) {
  const vault = yield* findVault(request.vaultId);
  const name = imageFileName(request.name);
  if (name === undefined) return yield* new InvalidImage({ reason: `Only images can be added: ${IMAGE_EXTENSIONS.join(", ")}` });
  if (request.bytes.length === 0) return yield* new InvalidImage({ reason: "The image is empty" });
  if (request.bytes.length > MAX_IMAGE_BYTES) return yield* new InvalidImage({ reason: "Images are limited to 20 MB" });

  const fs = yield* FileSystem.FileSystem;
  const folder = dirname(yield* resolveNewInVault(vault.rootPath, `${ASSETS_FOLDER}/${name}`));
  yield* fs.makeDirectory(folder, { recursive: true });
  const temporary = join(folder, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
  const path = yield* Effect.gen(function* () {
    yield* fs.writeFile(temporary, request.bytes);
    for (let attempt = 0; ; attempt += 1) {
      const file = candidate(name, attempt);
      const linked = yield* fs.link(temporary, join(folder, file)).pipe(
        Effect.as(true),
        Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
      );
      if (linked) return `${ASSETS_FOLDER}/${file}`;
    }
  }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)));

  yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: [path] }).pipe(
    Effect.catch((error) => Effect.logWarning(`indexing ${path} after adding it failed`, error)),
  );
  return { path } satisfies UploadImageResponse;
});
