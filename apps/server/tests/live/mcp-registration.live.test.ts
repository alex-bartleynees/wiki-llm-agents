import { describe, expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { startServer } from "../../src/features/providers/opencode/server.js";
import { VaultTools } from "../../src/features/mcp/vault-tools.js";
import { TestApp } from "../integration/infrastructure/test-app.js";
import { newThread, newVaultWith } from "../integration/infrastructure/threads.js";

/** Real protocol registration, no model invocation or paid tokens. */
describe.skipIf(process.env.WIKI_AGENTS_LIVE_OPENCODE !== "1")("real OpenCode MCP", () => {
  layer(TestApp, { excludeTestServices: true })("registration", (it) => {
    it.effect("connects the thread's authenticated vault MCP endpoint", () => Effect.scoped(Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Plan.md": "# Plan\n\nA protocol fixture." });
      const thread = yield* newThread(vault.id);
      const access = yield* (yield* VaultTools).open({ threadId: thread.id, vaultId: vault.id });
      const entry = yield* access.current;
      const api = yield* startServer({ binary: process.env.WIKI_AGENTS_OPENCODE ?? "opencode" });
      expect(yield* api.addMcpServer(vault.rootPath, entry)).toEqual({ _tag: "connected" });
      yield* api.removeMcpServer(vault.rootPath, entry.name);
    })), { timeout: 60000 });
  });
});
