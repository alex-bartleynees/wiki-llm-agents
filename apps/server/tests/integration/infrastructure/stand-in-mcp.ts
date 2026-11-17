import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * An upstream MCP server on 127.0.0.1, standing in for GitHub's or the coffee journal's:
 * Streamable HTTP with JSON answers and a session id, as servers on the MCP SDK answer.
 * It records what it was sent (to check versions, headers and how often the pool
 * connects) and can be taken down or have its tools changed.
 *
 * Tools: `echo` (read-only, says `text` back), `whoami` (says back the `Authorization`
 * header it got, to check redaction) and `fail` (a tool error).
 */
export interface StandInMcpOptions {
  /** MCP versions it speaks, preferred first; it answers an unknown one with the first. Default 2025-11-25 and 2025-06-18. */
  readonly versions?: ReadonlyArray<string>;
  /** Only requests with this `Authorization` header are let in; others get 401. */
  readonly authorization?: string;
}

export interface McpRequestSeen {
  readonly method: string;
  readonly protocolVersion: string | null;
  readonly authorization: string | null;
}

export interface StandInMcp {
  readonly url: string;
  /** Every JSON-RPC request, in order (notifications too). */
  readonly requests: Array<McpRequestSeen>;
  /** `initialize` requests that succeeded: one per connection the app opened. */
  readonly connections: () => number;
  /** Answers 503 to everything until called with false. */
  readonly setDown: (down: boolean) => void;
  readonly close: () => Promise<void>;
}

export const TOOLS = [
  {
    name: "echo",
    title: "Echo",
    description: "Says the text back.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    annotations: { readOnlyHint: true },
  },
  { name: "whoami", description: "Says back the Authorization header it got.", inputSchema: { type: "object", properties: {} } },
  { name: "fail", description: "Always fails.", inputSchema: { type: "object", properties: {} } },
];

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

interface JsonRpc {
  readonly id?: number | string;
  readonly method: string;
  readonly params?: { readonly protocolVersion?: string; readonly name?: string; readonly arguments?: Record<string, unknown> };
}

/** The MCP side alone, for putting behind another server's sign-in (the stand-in identity's `/mcp`). */
export const makeMcpHandler = (options: StandInMcpOptions = {}) => {
  const versions = options.versions ?? ["2025-11-25", "2025-06-18"];
  const requests: Array<McpRequestSeen> = [];
  let initialized = 0;
  let sessions = 0;
  let down = false;

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === "DELETE") return void response.writeHead(200).end();
    if (request.method !== "POST") return void response.writeHead(405).end();
    const body = JSON.parse(await readBody(request)) as JsonRpc;
    const authorization = request.headers.authorization ?? null;
    requests.push({ method: body.method, protocolVersion: (request.headers["mcp-protocol-version"] as string | undefined) ?? null, authorization });
    if (down) return void response.writeHead(503).end();
    if (options.authorization !== undefined && authorization !== options.authorization) {
      return void response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
    }
    if (body.id === undefined) return void response.writeHead(202).end();
    const reply = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
      void response.writeHead(200, { "content-type": "application/json", ...headers }).end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...payload }));
    const text = (value: string, isError = false) => reply({ result: { content: [{ type: "text", text: value }], isError } });

    switch (body.method) {
      case "initialize": {
        const asked = body.params?.protocolVersion ?? "";
        initialized += 1;
        sessions += 1;
        return reply(
          {
            result: {
              protocolVersion: versions.includes(asked) ? asked : versions[0],
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "stand-in", version: "1.0.0" },
            },
          },
          { "mcp-session-id": `session-${sessions}` },
        );
      }
      case "tools/list":
        return reply({ result: { tools: TOOLS } });
      case "tools/call": {
        const args = body.params?.arguments ?? {};
        if (body.params?.name === "echo") return text(String(args["text"] ?? ""));
        if (body.params?.name === "whoami") return text(`You sent ${authorization ?? "nothing"}`);
        if (body.params?.name === "fail") return text("It went wrong.", true);
        return reply({ error: { code: -32602, message: `Unknown tool ${body.params?.name}` } });
      }
      default:
        return reply({ error: { code: -32601, message: `Method not found: ${body.method}` } });
    }
  };

  return {
    handle,
    requests,
    connections: () => initialized,
    setDown: (value: boolean) => {
      down = value;
    },
  };
};

export const startStandInMcp = async (options: StandInMcpOptions = {}): Promise<StandInMcp> => {
  const mcp = makeMcpHandler(options);
  const server = createServer((request, response) => void mcp.handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    requests: mcp.requests,
    connections: mcp.connections,
    setDown: mcp.setDown,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
