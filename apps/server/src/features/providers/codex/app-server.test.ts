import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { providerEnvironment } from "../../../shared/provider-environment.js";
import { makeCodexLauncher } from "./app-server.js";
import type { JsonRpcMessage } from "./protocol.js";

const dir = mkdtempSync(join(tmpdir(), "wiki-agents-codex-env-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Stands in for `codex app-server`: reports the variables it was started with, as one message. */
const binary = join(dir, "fake-codex");
writeFileSync(
  binary,
  `#!/bin/sh
printf '{"method":"env","params":{"kept":"%s","app":"%s","withheld":"%s","token":"%s"}}\\n' "$KEPT" "$WIKI_AGENTS_DATA_DIR" "$NPM_TOKEN" "$WIKI_AGENTS_VAULT_TOKEN"
`,
);
chmodSync(binary, 0o755);

describe("makeCodexLauncher", () => {
  it("starts Codex with the given environment plus the launch's additions", async () => {
    const source = { PATH: process.env.PATH, KEPT: "kept", WIKI_AGENTS_DATA_DIR: "/data", NPM_TOKEN: "npm-secret" };
    const launcher = makeCodexLauncher(providerEnvironment(source, { withhold: ["NPM_TOKEN"], pass: [] }));
    const message = await new Promise<JsonRpcMessage>((resolve, reject) => {
      const child = launcher.launch({ binary, cwd: dir, env: { WIKI_AGENTS_VAULT_TOKEN: "thread-token" } });
      child.listen({ message: resolve, exit: (reason) => reject(new Error(reason ?? "exited without a message")) });
    });
    expect(message).toEqual({ method: "env", params: { kept: "kept", app: "", withheld: "", token: "thread-token" } });
  });
});
