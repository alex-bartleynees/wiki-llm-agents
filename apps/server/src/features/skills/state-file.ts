import { randomUUID } from "node:crypto";
import { Effect, FileSystem } from "effect";

export const writeAtomic = Effect.fnUntraced(function* (path: string, content: string, mode = 0o600) {
  const fs = yield* FileSystem.FileSystem;
  const temporary = path + "." + randomUUID() + ".tmp";
  yield* fs.writeFileString(temporary, content, { flag: "wx", mode }).pipe(
    Effect.andThen(fs.rename(temporary, path)),
    Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
  );
});
