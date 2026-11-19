import type { SecretSignInUse, SecretSummary } from "@wiki-agents/contracts/secrets/model";
import { Effect } from "effect";
import { McpServerCatalog } from "../mcp-servers/catalog.js";
import type { McpServerDefinition } from "../mcp-servers/definition.js";
import { ProjectRepository } from "../projects/repository.js";
import type { SecretInfo } from "./secret-store.js";

const SECRET_REFERENCE = /\$\{secret:([^}]*)\}/g;

/** The secret names a server's headers or environment refer to. */
export const secretsOf = ({ transport }: McpServerDefinition): ReadonlySet<string> => {
  const values = transport.type === "stdio" ? Object.values(transport.env) : Object.values(transport.headers);
  return new Set(values.flatMap((value) => [...value.matchAll(SECRET_REFERENCE)].map((match) => match[1] ?? "")));
};

/** What refers to a secret: MCP servers by id, and projects' browser sign-ins. */
export interface SecretUses {
  readonly servers: ReadonlyArray<string>;
  readonly signIns: ReadonlyArray<SecretSignInUse>;
}

/** What refers to each secret name, read once for a request. */
export const secretUsers = Effect.gen(function* () {
  const { servers } = yield* (yield* McpServerCatalog).current;
  const projects = yield* ProjectRepository;
  const names = new Map((yield* projects.list).map((project) => [project.id, project.name]));
  const signIns = (yield* projects.allBrowserSignIns).flatMap(({ projectId, signIns: list }) =>
    list.map((signIn) => ({ projectId, project: names.get(projectId) ?? projectId, signIn })),
  );
  return (name: string): SecretUses => ({
    servers: servers.filter((server) => secretsOf(server).has(name)).map((server) => server.id),
    signIns: signIns
      .filter(({ signIn }) => signIn.credentials.some((credential) => credential.secret === name))
      .map(({ projectId, project, signIn }) => ({ projectId, project, signIn: signIn.name })),
  });
});

export const summarise = (info: SecretInfo, uses: SecretUses): SecretSummary => ({ ...info, usedBy: uses.servers, usedBySignIns: uses.signIns });
