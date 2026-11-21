import type { AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { type BrowserSignIn, originOf } from "@wiki-agents/contracts/projects/model";

/**
 * The gateway's checks on a browser typing a sign-in's secret (see
 * `mcp-servers/sign-ins.ts`). Playwright types a secret's value when the text of a
 * `browser_type` call, or a `browser_fill_form` field's value, is exactly a
 * credential's name, so those are what is checked:
 * - only on a page at one of the sign-in's sites, as the browser last reported it;
 * - never without asking you first, whatever the agent's autonomy.
 */

export const TYPING_TOOLS: ReadonlyArray<string> = ["browser_type", "browser_fill_form"];

export interface TypedCredential {
  readonly variable: string;
  readonly signIn: BrowserSignIn;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The texts Playwright would look up as secrets in a call to `tool`. */
const typedTexts = (tool: string, args: unknown): ReadonlyArray<string> => {
  if (!isRecord(args)) return [];
  if (tool === "browser_type") return typeof args["text"] === "string" ? [args["text"]] : [];
  if (tool === "browser_fill_form" && Array.isArray(args["fields"])) {
    return args["fields"].flatMap((field) => (isRecord(field) && typeof field["value"] === "string" ? [field["value"]] : []));
  }
  return [];
};

export const typedCredentials = (tool: string, args: unknown, signIns: ReadonlyArray<BrowserSignIn>): ReadonlyArray<TypedCredential> => {
  if (!TYPING_TOOLS.includes(tool)) return [];
  const texts = new Set(typedTexts(tool, args));
  return signIns.flatMap((signIn) => signIn.credentials.filter((credential) => texts.has(credential.variable)).map((credential) => ({ variable: credential.variable, signIn })));
};

/** The page a browser result is on: the last `- Page URL: …` line in its text, or null. */
export const pageUrlOf = (result: unknown): string | null => {
  if (!isRecord(result) || !Array.isArray(result["content"])) return null;
  let found: string | null = null;
  for (const block of result["content"]) {
    if (!isRecord(block) || typeof block["text"] !== "string") continue;
    for (const match of block["text"].matchAll(/^- Page URL: (\S+)\s*$/gm)) found = match[1] ?? found;
  }
  return found;
};

/**
 * Why the call may not type these credentials on `page` (the browser's last reported
 * page, null before it reported one), as the agent is told it; null when it may.
 */
export const signInRefusal = (typed: ReadonlyArray<TypedCredential>, page: string | null): string | null => {
  const origin = page === null ? null : originOf(page);
  for (const { variable, signIn } of typed) {
    const allowed = signIn.origins.map((site) => originOf(site)).filter((site): site is string => site !== null);
    if (origin === null || !allowed.includes(origin)) {
      const where = page === null ? "the browser hasn't reported a page yet" : `the page is ${page}`;
      return `${variable} may only be typed on ${allowed.join(" or ")} (the sign-in "${signIn.name}"), and ${where}. Open the sign-in page with browser_navigate first, then type it. If the login moved to another site (an identity provider), ask the user to add that site to the sign-in in the project.`;
    }
  }
  return null;
};

/** A call typing a credential always asks: `allow` becomes `ask`; `deny` stays. */
export const askingLevel = (level: AutonomyLevel): AutonomyLevel => (level === "allow" ? "ask" : level);

/** What the approval card adds: which sign-in's credentials, where. Names only, never a value. */
export const signInDetail = (typed: ReadonlyArray<TypedCredential>, page: string | null): string =>
  `Types ${typed.map(({ variable, signIn }) => `${variable} (sign-in "${signIn.name}")`).join(", ")} on ${page ?? "the current page"}. The browser types the secret's value; it isn't shown to the agent or here.`;
