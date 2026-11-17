import type { AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import type { McpScope, McpServerInput, McpServerSummary } from "@wiki-agents/contracts/mcp-servers/model";

/** The editor's fields: both transports' settings are kept while you switch between them. */
export interface ServerForm {
  title: string;
  type: "stdio" | "http";
  command: string;
  /** One argument per line. */
  args: string;
  /** `NAME=value`, one per line. */
  env: string;
  cwd: string;
  url: string;
  /** `Name: value`, one per line. */
  headers: string;
  /** Sign-in: the client registered at the identity server; empty to register one when connecting. */
  clientId: string;
  /** Sign-in scopes, separated by spaces or new lines; empty for those the server advertises. */
  scopes: string;
  scope: McpScope;
  /** Give its tools to every thread. */
  everyThread: boolean;
  /** Empty to follow the agent's autonomy. */
  access: AutonomyLevel | "";
}

export const BLANK_FORM: ServerForm = {
  title: "",
  type: "http",
  command: "",
  args: "",
  env: "",
  cwd: "",
  url: "",
  headers: "",
  clientId: "",
  scopes: "",
  scope: "app",
  everyThread: false,
  access: "",
};

export const formFromServer = (server: McpServerInput): ServerForm => ({
  ...BLANK_FORM,
  title: server.title,
  scope: server.scope,
  everyThread: server.default,
  access: server.access ?? "",
  ...(server.transport.type === "stdio"
    ? {
        type: "stdio" as const,
        command: server.transport.command,
        args: server.transport.args.join("\n"),
        env: Object.entries(server.transport.env).map(([name, value]) => `${name}=${value}`).join("\n"),
        cwd: server.transport.cwd ?? "",
      }
    : {
        type: "http" as const,
        url: server.transport.url,
        headers: Object.entries(server.transport.headers).map(([name, value]) => `${name}: ${value}`).join("\n"),
        clientId: server.oauth?.clientId ?? "",
        scopes: (server.oauth?.scopes ?? []).join(" "),
      }),
});

/** `NAME<separator>value` lines as a record; lines without a name or separator are reported by number. */
const pairs = (text: string, separator: string, what: string) => {
  const values: Record<string, string> = {};
  const problems: Array<string> = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const at = line.indexOf(separator);
    const name = at < 0 ? "" : line.slice(0, at).trim();
    if (name === "") problems.push(`Line ${index + 1} of ${what} should read NAME${separator}value.`);
    else values[name] = line.slice(at + separator.length).trim();
  });
  return { values, problems };
};

/** What the form saves, or what to fix in it first. */
export const inputFromForm = (form: ServerForm): { readonly input: McpServerInput } | { readonly problems: ReadonlyArray<string> } => {
  const shared = { title: form.title.trim(), scope: form.scope, default: form.everyThread, access: form.access === "" ? null : form.access, oauth: null };
  if (form.type === "stdio") {
    const env = pairs(form.env, "=", "the environment");
    if (env.problems.length > 0) return { problems: env.problems };
    const args = form.args.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    return { input: { ...shared, transport: { type: "stdio", command: form.command.trim(), args, env: env.values, cwd: form.cwd.trim() === "" ? null : form.cwd.trim() } } };
  }
  const headers = pairs(form.headers, ":", "the headers");
  if (headers.problems.length > 0) return { problems: headers.problems };
  const clientId = form.clientId.trim();
  const scopes = form.scopes.split(/\s+/).filter((scope) => scope !== "");
  const oauth = clientId === "" && scopes.length === 0 ? null : { clientId: clientId === "" ? null : clientId, scopes };
  return { input: { ...shared, oauth, transport: { type: "http", url: form.url.trim(), headers: headers.values } } };
};

/** The file name for a new server: `My Browser` → `my-browser`. */
export const idFromTitle = (title: string) =>
  title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The id the server accepts (`ID_PATTERN` there). */
export const isValidId = (id: string) => /^[a-z0-9][a-z0-9-]*$/.test(id);

/** `https://api.example.com/mcp` or `npx -y @playwright/mcp`: where the server is, without its headers or environment. */
export const describeTransport = ({ transport }: McpServerSummary) =>
  transport.type === "http" ? transport.url : [transport.command, ...transport.args].join(" ");

export const SCOPE_LABELS: Readonly<Record<McpScope, string>> = {
  app: "One connection for the whole app",
  project: "One connection per project",
  thread: "One connection per thread",
};
