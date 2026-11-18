import { Effect } from "effect";
import { AppConfig } from "./config.js";

/**
 * The environment provider processes (OpenCode, Claude Code, Codex) start with, and so
 * the one every command an agent runs can read. It is the app's own environment minus
 * the app's settings (`WIKI_AGENTS_*`), any names the user withholds, and the variables
 * MCP servers take secrets from (`${env:…}`), so PATH, HOME, SSH_AUTH_SOCK, Nix and
 * provider keys go through unchanged.
 */

/** The app's own settings: paths, ports and key files no agent needs. */
const APP_PREFIX = "WIKI_AGENTS_";

/**
 * Where the stored secrets' key is and which files hold declared secrets
 * (`WIKI_AGENTS_SECRETS_KEY_FILE`, `WIKI_AGENTS_SECRET_FILES`...): kept from providers
 * even when `pass` names them, so no setting hands an agent the way to a secret.
 */
const NEVER_PASSED = /^WIKI_AGENTS_SECRET/;

export interface ProviderEnvironmentRules {
  /** Names kept from providers, on top of the app's own. A trailing `*` matches a prefix. */
  readonly withhold: ReadonlyArray<string>;
  /** Names passed anyway, over `withhold` and the app's own. A trailing `*` matches a prefix. */
  readonly pass: ReadonlyArray<string>;
  /** Exact names kept from providers even when `pass` names them: those MCP servers' `${env:…}` references read. */
  readonly secrets?: ReadonlyArray<string>;
}

/** Names from a setting such as `AWS_*, NPM_TOKEN`: separated by commas or spaces. */
export const parseNames = (value: string): ReadonlyArray<string> => value.split(/[\s,]+/).filter((name) => name !== "");

const matches = (patterns: ReadonlyArray<string>, name: string) =>
  patterns.some((pattern) => (pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern));

export const providerEnvironment = (source: NodeJS.ProcessEnv, rules: ProviderEnvironmentRules): Record<string, string> => {
  const secrets = new Set(rules.secrets ?? []);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || NEVER_PASSED.test(name) || secrets.has(name)) continue;
    const withheld = name.startsWith(APP_PREFIX) || matches(rules.withhold, name);
    if (withheld && !matches(rules.pass, name)) continue;
    env[name] = value;
  }
  return env;
};

/** Works out a process's environment when it starts, so a variable an MCP server took up since is already withheld. */
export type EnvironmentSource = () => Readonly<Record<string, string>>;

/**
 * What provider processes, and the MCP servers the app runs itself, start with: this
 * process's environment without the app's own settings, as
 * `WIKI_AGENTS_PROVIDER_ENV_WITHHOLD` and `_PASS` adjust it, and without `secrets()`
 * (the secrets feature's latest `${env:…}` names), read each time.
 */
export const makeProviderEnvironment = (secrets: () => ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const withhold = parseNames(yield* AppConfig.providerEnvWithhold.pipe(Effect.orDie));
    const pass = parseNames(yield* AppConfig.providerEnvPass.pipe(Effect.orDie));
    const source: EnvironmentSource = () => providerEnvironment(process.env, { withhold, pass, secrets: secrets() });
    return source;
  });
