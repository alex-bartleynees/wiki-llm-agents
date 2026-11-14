import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { Effect, FileSystem, Layer } from "effect";
import { AppConfig } from "../../shared/config.js";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { AttachmentNotFound, AttachmentStorageError, AttachmentStore, InvalidAttachment, type StoredAttachment } from "./attachment-store.js";
import { attachmentFileName, classifyAttachment } from "./classify.js";
import { attachments } from "./table.js";
import { MAX_ATTACHMENT_BYTES } from "@wiki-agents/contracts/attachments/model";

type Row = typeof attachments.$inferSelect;

/**
 * Attachments in SQLite, their bytes under `root` at `<sha256>/<name>`: written to a
 * hidden temp file in `root` and renamed into place, so a file there is always whole.
 */
export const makeAttachmentStore = (root: string) =>
  Layer.effect(
    AttachmentStore,
    Effect.gen(function* () {
      const { db } = yield* Sqlite;
      const fs = yield* FileSystem.FileSystem;
      const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
      const stored = (row: Row): StoredAttachment => ({
        id: row.id,
        name: row.name,
        mime: row.mime,
        size: row.size,
        kind: row.kind,
        path: join(root, row.sha256, row.name),
      });
      const storageFailed = (cause: unknown) => new AttachmentStorageError({ cause });

      /** Puts the bytes at `<sha256>/<name>` unless a whole copy is already there. */
      const writeFile = Effect.fnUntraced(function* (sha256: string, name: string, bytes: Uint8Array) {
        const folder = join(root, sha256);
        const target = join(folder, name);
        const existing = yield* fs.stat(target).pipe(Effect.option);
        if (existing._tag === "Some" && Number(existing.value.size) === bytes.length) return;
        yield* fs.makeDirectory(folder, { recursive: true });
        const temporary = join(root, `.${randomBytes(6).toString("hex")}.tmp`);
        yield* fs.writeFile(temporary, bytes).pipe(
          Effect.andThen(fs.rename(temporary, target)),
          Effect.onError(() => fs.remove(temporary).pipe(Effect.ignore)),
        );
      });

      return {
        root,
        save: Effect.fnUntraced(function* (name: string, bytes: Uint8Array) {
          const cleaned = attachmentFileName(name);
          if (cleaned === undefined) return yield* new InvalidAttachment({ reason: "The file needs a name" });
          if (bytes.length === 0) return yield* new InvalidAttachment({ reason: "The file is empty" });
          if (bytes.length > MAX_ATTACHMENT_BYTES) return yield* new InvalidAttachment({ reason: "Attachments are limited to 100 MB" });
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          yield* writeFile(sha256, cleaned, bytes).pipe(Effect.mapError(storageFailed));
          const { mime, kind } = classifyAttachment(cleaned, bytes);
          const row = yield* query(() => {
            db.insert(attachments)
              .values({ id: randomUUID(), sha256, name: cleaned, mime, size: bytes.length, kind, createdAt: new Date() })
              .onConflictDoNothing()
              .run();
            return db.select().from(attachments).where(eq(attachments.sha256, sha256)).all().find((found) => found.name === cleaned)!;
          });
          return stored(row);
        }),
        find: Effect.fnUntraced(function* (ids: ReadonlyArray<string>) {
          if (ids.length === 0) return [];
          const rows = yield* query(() => db.select().from(attachments).where(inArray(attachments.id, [...ids])).all());
          const byId = new Map(rows.map((row) => [row.id, row]));
          const found: Array<StoredAttachment> = [];
          for (const id of ids) {
            const row = byId.get(id);
            if (row === undefined) return yield* new AttachmentNotFound({ attachmentId: id });
            found.push(stored(row));
          }
          return found;
        }),
      };
    }),
  );

/** Attachments under the data directory, as configured. */
export const AttachmentStoreLive = Layer.unwrap(
  Effect.map(AppConfig.dataDir.pipe(Effect.orDie), (dataDir) => makeAttachmentStore(join(dataDir, "attachments"))),
);
