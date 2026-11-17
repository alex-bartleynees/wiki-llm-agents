import type { McpConnection } from "@wiki-agents/contracts/mcp-oauth/model";
import type { McpServerSummary } from "@wiki-agents/contracts/mcp-servers/model";

/** Whether the app signs in to a server: reached by URL, without an `Authorization` header of its own (as the server decides). */
export const canSignIn = ({ transport }: McpServerSummary) =>
  transport.type === "http" && !Object.keys(transport.headers).some((name) => name.toLowerCase() === "authorization");

/** A sign-in's state in a few words, for the server's line in the list. */
export const connectionText = (connection: McpConnection): string => {
  switch (connection.state) {
    case "connected":
      return connection.renews ? "Signed in; renewed automatically" : "Signed in";
    case "expired":
      return "Sign-in ran out; connect again";
    case "changed":
      return "Address or client id changed; connect again";
    case "unreadable":
      return "Sign-in can't be read";
    case "disconnected":
      return "Not signed in";
  }
};

/** The button that starts a sign-in. */
export const connectLabel = (connection: McpConnection | undefined) => (connection === undefined || connection.state === "disconnected" ? "Connect" : "Reconnect");

/** Name of the channel the callback's Settings tab tells the others on, so they show the new sign-in. */
export const SIGN_IN_CHANNEL = "wiki-agents-mcp-sign-in";
