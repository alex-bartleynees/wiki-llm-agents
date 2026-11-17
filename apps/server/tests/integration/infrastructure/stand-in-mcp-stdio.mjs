// An MCP server over stdio for the connection pool's tests, run with node. Tools:
// `env` (says back an environment variable), `cwd` (where it runs), `echo`, and
// `exit` (stops the process, as a server that crashes).
import { createInterface } from "node:readline";

const VERSIONS = ["2025-11-25", "2025-06-18"];
const TOOLS = [
  { name: "env", inputSchema: { type: "object", properties: { name: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "cwd", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "exit", inputSchema: { type: "object", properties: {} } },
];

/** @param {Record<string, unknown>} message */
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const text = (id, value) => send({ id, result: { content: [{ type: "text", text: value }], isError: false } });

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "") return;
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  switch (method) {
    case "initialize":
      return send({
        id,
        result: {
          protocolVersion: VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "stand-in-stdio", version: "1.0.0" },
        },
      });
    case "tools/list":
      return send({ id, result: { tools: TOOLS } });
    case "tools/call": {
      const args = params?.arguments ?? {};
      if (params?.name === "env") return text(id, process.env[args.name] ?? "(unset)");
      if (params?.name === "cwd") return text(id, process.cwd());
      if (params?.name === "echo") return text(id, String(args.text ?? ""));
      if (params?.name === "exit") process.exit(3);
      return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
    }
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
