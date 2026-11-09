import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";

export interface TestVault {
  /** Canonical path of the vault folder. */
  readonly root: string;
  /** A sibling folder outside the vault, for escape tests. */
  readonly outside: string;
}

/**
 * A vault folder with the given files (path → contents) and symlinks
 * (link path in the vault → target path relative to the temp base), removed when
 * the scope closes.
 */
export const makeTestVault = (options: {
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly symlinks?: Readonly<Record<string, string>>;
}) =>
  Effect.acquireRelease(
    Effect.sync((): TestVault => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-vault-")));
      const root = join(base, "vault");
      const outside = join(base, "outside");
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(outside, "secret.md"), "# Secret");
      for (const [path, contents] of Object.entries(options.files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), contents);
      }
      for (const [path, target] of Object.entries(options.symlinks ?? {})) {
        symlinkSync(join(base, target), join(root, path));
      }
      return { root, outside };
    }),
    ({ root }) => Effect.sync(() => rmSync(dirname(root), { recursive: true, force: true })),
  );
