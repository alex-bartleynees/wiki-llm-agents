import { ID_PATTERN } from "../../shared/config-files.js";

/** Secrets declared in the service's configuration: each a name and the file holding its value. */
export interface DeclaredSecrets {
  /** Name → absolute path. */
  readonly files: ReadonlyMap<string, string>;
  /** Entries that couldn't be used, for Settings. */
  readonly problems: ReadonlyArray<string>;
}

/**
 * `WIKI_AGENTS_SECRET_FILES`: `name=/path` entries separated by commas or new lines,
 * e.g. `github=/run/secrets/github,jira=/run/secrets/jira`. Names are those of
 * `${secret:<name>}`; a later entry replaces an earlier one of the same name.
 */
export const parseDeclaredSecrets = (value: string): DeclaredSecrets => {
  const files = new Map<string, string>();
  const problems: Array<string> = [];
  for (const entry of value.split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== "")) {
    const at = entry.indexOf("=");
    const name = at < 0 ? "" : entry.slice(0, at).trim();
    const path = at < 0 ? "" : entry.slice(at + 1).trim();
    if (!ID_PATTERN.test(name)) problems.push(`"${entry}": write it as name=/path, the name in lowercase letters, digits and hyphens.`);
    else if (!path.startsWith("/")) problems.push(`"${entry}": give the file's full path.`);
    else files.set(name, path);
  }
  return { files, problems };
};
