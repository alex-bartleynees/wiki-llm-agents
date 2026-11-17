import type { SecretSummary } from "@wiki-agents/contracts/secrets/model";
import { Effect } from "effect";
import { McpServerCatalog } from "../mcp-servers/catalog.js";
import type { McpServerDefinition } from "../mcp-servers/definition.js";
import type { SecretInfo } from "./secret-store.js";

const SECRET_REFERENCE = /\$\{secret:([^}]*)\}/g;

/** The secret names a server's headers or environment refer to. */
export const secretsOf = ({ transport }: McpServerDefinition): ReadonlySet<string> => {
  const values = transport.type === "stdio" ? Object.values(transport.env) : Object.values(transport.headers);
  return new Set(values.flatMap((value) => [...value.matchAll(SECRET_REFERENCE)].map((match) => match[1] ?? "")));
};

/** Ids of the MCP servers that refer to each secret name. */
export const secretUsers = Effect.gen(function* () {
  const { servers } = yield* (yield* McpServerCatalog).current;
  return (name: string) => servers.filter((server) => secretsOf(server).has(name)).map((server) => server.id);
});

export const summarise = (info: SecretInfo, usedBy: ReadonlyArray<string>): SecretSummary => ({ ...info, usedBy });
