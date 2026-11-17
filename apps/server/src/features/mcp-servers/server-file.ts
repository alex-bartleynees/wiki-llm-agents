import type { McpServerInput } from "@wiki-agents/contracts/mcp-servers/model";
import { Document, isMap, parseDocument, YAMLMap } from "yaml";

const transportOf = ({ transport }: McpServerInput) =>
  transport.type === "stdio"
    ? {
        type: "stdio",
        command: transport.command.trim(),
        ...(transport.args.length === 0 ? {} : { args: transport.args }),
        ...(Object.keys(transport.env).length === 0 ? {} : { env: transport.env }),
        ...(transport.cwd === null ? {} : { cwd: transport.cwd.trim() }),
      }
    : {
        type: "http",
        url: transport.url.trim(),
        ...(Object.keys(transport.headers).length === 0 ? {} : { headers: transport.headers }),
      };

/**
 * A server file with `input`'s settings. When `existing` (the file as it is on disk)
 * is a YAML map, its settings are replaced in place, so comments above them and
 * their order stay. `access` is left out when it follows the agent.
 *
 * The result isn't checked here; the caller parses it as the loader would.
 */
export const mcpServerFileText = (input: McpServerInput, existing: string | null): string => {
  let doc: Document = existing === null ? new Document(new YAMLMap()) : parseDocument(existing);
  // A file that isn't a map (or doesn't parse) can't be edited in place.
  if (doc.errors.length > 0 || !isMap(doc.contents)) doc = new Document(new YAMLMap());
  doc.set("title", input.title.trim());
  doc.set("transport", doc.createNode(transportOf(input)));
  doc.set("scope", input.scope);
  doc.set("default", input.default);
  if (input.access === null) doc.delete("access");
  else doc.set("access", input.access);
  return `${doc.toString({ lineWidth: 0 }).trimEnd()}\n`;
};
