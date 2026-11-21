import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { providerEnvironment } from "../../../shared/provider-environment.js";
import { makeCodexLauncher, makeRpc } from "./app-server.js";
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
    const launcher = makeCodexLauncher(() => providerEnvironment(source, { withhold: ["NPM_TOKEN"], pass: [] }));
    const message = await new Promise<JsonRpcMessage>((resolve, reject) => {
      const child = launcher.launch({ binary, cwd: dir, env: { WIKI_AGENTS_VAULT_TOKEN: "thread-token" } });
      child.listen({ message: resolve, exit: (reason) => reject(new Error(reason ?? "exited without a message")) });
    });
    expect(message).toEqual({ method: "env", params: { kept: "kept", app: "", withheld: "", token: "thread-token" } });
  });
  it("delivers buffered replies and closes when a descendant holds the exited child's pipes", async () => {
    const inherited = join(dir, "inherited-pipes");
    const pidFile = join(dir, "descendant.pid");
    writeFileSync(inherited, `#!/bin/sh
sleep 30 </dev/null &
printf '%s\\n' "$!" > descendant.pid
IFS= read -r first
IFS= read -r second
printf '{"id":1,"result":"final reply"}\\n'
printf 'final diagnostic\\n' >&2
exit 7
`, { mode: 0o755 });
    const child = makeCodexLauncher(() => process.env).launch({ binary: inherited, cwd: dir, env: {} });
    try {
      const rpc = makeRpc(child, () => {}, () => {});
      const replied = rpc.request("replied", {});
      const unanswered = rpc.request("unanswered", {});
      const [reply, failure] = await Promise.allSettled([replied, unanswered]);
      expect(reply).toEqual({ status: "fulfilled", value: "final reply" });
      expect(failure).toMatchObject({
        status: "rejected",
        reason: { message: expect.stringContaining("exit code 7: final diagnostic") },
      });
      await child.closed;
      expect(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0)).not.toThrow();
    } finally {
      child.kill();
      try {
        process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
      } catch (error) {
        if (!["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
    }
  });

});
