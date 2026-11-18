import { Context, type Effect } from "effect";

/** What no agent may reach, read from the secret store, the MCP server files and the configuration at one moment. */
export interface SecretMaterialList {
  /**
   * Absolute paths of files and folders no agent may reach: the stored secrets, their
   * key, declared secret files, every `${file:…}` an MCP server refers to, and the paths
   * in `WIKI_AGENTS_PROTECTED_PATHS`. Each in its written form and, where it exists and
   * differs, its canonical one. Sorted.
   */
  readonly paths: ReadonlyArray<string>;
  /** Name patterns from `WIKI_AGENTS_PROTECTED_PATHS`, `!` exceptions included, as written (see `Protection.names`). */
  readonly names: ReadonlyArray<string>;
  /** Environment variables MCP servers refer to with `${env:…}`: withheld from providers whatever the settings. Sorted. */
  readonly envNames: ReadonlyArray<string>;
}

/**
 * The secrets agents never get: their files are denied in every adapter and their
 * environment variables withheld from providers. Features read it through this port.
 */
export interface SecretMaterialService {
  /** Read now (MCP server files change at runtime). */
  readonly current: Effect.Effect<SecretMaterialList>;
  /**
   * What `current` last read (once when the app starts), for code that can't wait on
   * an effect, such as a provider's environment when its process starts.
   */
  readonly latest: () => SecretMaterialList;
}

export class SecretMaterial extends Context.Service<SecretMaterial, SecretMaterialService>()("SecretMaterial") {}
