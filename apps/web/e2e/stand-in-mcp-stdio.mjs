// An MCP server over stdio for Settings' Test and Restart, run with node: two tools,
// one read-only. The server tests have a fuller one; the two apps don't share code.
import { createInterface } from "node:readline";

const TOOLS = [
  { name: "search_beans", description: "Finds beans by name.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "log_brew", description: "Adds a brew to the journal.", inputSchema: { type: "object", properties: {} } },
];
/** @param {Record<string, unknown>} message */
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "") return;
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  if (method === "initialize") {
    return send({ id, result: { protocolVersion: params?.protocolVersion ?? "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "stand-in", version: "1.0.0" } } });
  }
  if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
});
