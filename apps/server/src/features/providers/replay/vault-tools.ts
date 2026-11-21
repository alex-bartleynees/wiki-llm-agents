import { Effect } from "effect";
import type { SessionSetup } from "../port.js";
import { ProviderError } from "../port.js";

/** Replay uses the real MCP endpoint so its approval/review flow can be exercised without a model. */
type CallTool = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;

const usingTools = (tools: SessionSetup["vaultTools"], use: (call: CallTool) => Promise<unknown>, action: string) => Effect.tryPromise({
  try: async () => {
    if (tools === null) throw new Error("Replay has no vault tools.");
    const headers: Record<string, string> = { authorization: `Bearer ${tools.token}`, accept: "application/json, text/event-stream", "content-type": "application/json" };
    let id = 0;
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(tools.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      if (!response.ok) throw new Error(`MCP answered ${response.status}.`);
      const session = response.headers.get("mcp-session-id");
      if (session !== null) headers["mcp-session-id"] = session;
      const body = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }>; structuredContent?: Record<string, unknown> }; error?: { message: string } };
      if (body.error !== undefined) throw new Error(body.error.message);
      return body.result;
    };
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "replay", version: "1" } });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await rpc("tools/call", { name, arguments: args });
      if (result?.isError) throw new Error(result.content?.[0]?.text ?? "Vault tool failed.");
      return result?.structuredContent;
    };
    return JSON.stringify(await use(call));
  },
  catch: (cause) => new ProviderError({ message: `Replay's ${action} was refused or interrupted: ${cause instanceof Error ? cause.message : String(cause)}` }),
});

export const createChildThread = (tools: SessionSetup["vaultTools"], title: string, prompt: string) =>
  usingTools(tools, (call) => call("thread_create", { title, prompt }), "child launch");

export const writeVaultNote = (tools: SessionSetup["vaultTools"], operation: "vault-create" | "vault-edit", path: string, content: string) =>
  usingTools(tools, async (call) => {
    const baseHash = operation === "vault-edit" ? (await call("vault_read_note", { path }))?.["hash"] : undefined;
    return call(operation === "vault-create" ? "vault_create_note" : "vault_edit_note", { path, content, ...(baseHash === undefined ? {} : { baseHash }) });
  }, "vault write");
