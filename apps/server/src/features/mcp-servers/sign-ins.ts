import type { BrowserSignIn } from "@wiki-agents/contracts/projects/model";

/**
 * A project's browser sign-ins reaching the built-in browser (Playwright MCP's
 * `--secrets`): the app writes the secrets' values to a dotenv file only Playwright
 * reads, once, when it starts. When the agent types a credential's name
 * (`APP_PASSWORD`) with `browser_type` or `browser_fill_form`, Playwright types the
 * value instead, and puts the name back wherever the value shows in its answers.
 *
 * Playwright calls this "a convenience and not a security feature", so the gateway
 * also refuses a name typed on a page outside the sign-in's sites, and always asks
 * first (`mcp/sign-in-guard.ts`); and the pool redacts the values from every result.
 */

/** Playwright's flag for the file. */
export const SECRETS_FLAG = "--secrets";

/**
 * One `NAME=value` line Playwright's dotenv parser reads back exactly, or null when
 * the value can't be written so: single quotes and backticks keep everything between
 * them as is; double quotes turn `\n` into a line break, so only without one.
 */
export const dotenvLine = (name: string, value: string): string | null => {
  if (!value.includes("'")) return `${name}='${value}'`;
  if (!value.includes("`")) return `${name}=\`${value}\``;
  if (!value.includes('"') && !/\\[nr]/.test(value)) return `${name}="${value}"`;
  return null;
};

/** The credentials a browser gets: every sign-in's, by the name the agent types. */
export const credentialsOf = (signIns: ReadonlyArray<BrowserSignIn>) =>
  signIns.flatMap((signIn) => signIn.credentials.map((credential) => ({ signIn: signIn.name, ...credential })));

/** What a browser connection was opened with: different credentials open a new one. */
export const signInsFingerprint = (signIns: ReadonlyArray<BrowserSignIn>) =>
  JSON.stringify(credentialsOf(signIns).map(({ variable, secret }) => [variable, secret]));
