// An MCP server over stdio for the connection pool's tests, run with node. Tools:
// `env` (says back an environment variable), `cwd` (where it runs), `args` (its command
// line arguments, one per line), `echo`, and `exit` (stops the process, as a server that
// crashes).
//
// Started with `--isolated` (the built-in browser's flags), it also stands in for
// Playwright MCP's sign-ins: it reads `--secrets <file>` once as it starts, as
// Playwright does, and has `browser_navigate` (answers with its `- Page URL:` line),
// `browser_type` (types a secret's value for its name, and echoes what it typed, as a
// careless page might) and `secrets_file` (the file's mode as it was read, and whether
// it is still there).
import { existsSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

const VERSIONS = ["2025-11-25", "2025-06-18"];
const TOOLS = [
  { name: "env", inputSchema: { type: "object", properties: { name: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "cwd", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "args", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "exit", inputSchema: { type: "object", properties: {} } },
];

const argv = process.argv.slice(2);
const browser = argv.includes("--isolated");
const secretsPath = argv.includes("--secrets") ? argv[argv.indexOf("--secrets") + 1] : undefined;
/** @type {Record<string, string>} */
const secrets = {};
const secretsMode = secretsPath === undefined ? null : (statSync(secretsPath).mode & 0o777).toString(8);
if (secretsPath !== undefined) {
  // The app writes NAME='value' (or backticks, or double quotes).
  for (const [, name, , value] of readFileSync(secretsPath, "utf8").matchAll(/^([A-Z0-9_]+)=(['`"])([\s\S]*?)\2$/gm)) secrets[name] = value;
}
let page = "about:blank";
if (browser) {
  TOOLS.push(
    { name: "browser_navigate", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
    { name: "browser_type", inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" } } } },
    { name: "secrets_file", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  );
}
const pageLines = () => `### Page\n- Page URL: ${page}\n- Page Title: Stand-in`;

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
      if (params?.name === "args") return text(id, process.argv.slice(2).join("\n"));
      if (params?.name === "echo") return text(id, String(args.text ?? ""));
      if (params?.name === "exit") process.exit(3);
      if (browser && params?.name === "browser_navigate") {
        page = String(args.url ?? "about:blank");
        return text(id, pageLines());
      }
      if (browser && params?.name === "browser_type") {
        const typed = secrets[args.text] ?? String(args.text ?? "");
        return text(id, `Typed "${typed}"\n${pageLines()}`);
      }
      if (browser && params?.name === "secrets_file") {
        return text(id, JSON.stringify({ mode: secretsMode, stillThere: secretsPath !== undefined && existsSync(secretsPath), names: Object.keys(secrets) }));
      }
      return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
    }
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
