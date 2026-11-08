import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Config } from "effect";

const xdgDataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");

/** Process configuration. Every value has a default so `wiki-agents` starts with no setup. */
export const AppConfig = {
  /** Loopback only; remote access comes later with authentication. */
  host: Config.String("WIKI_AGENTS_HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.Port("WIKI_AGENTS_PORT").pipe(Config.withDefault(4317)),
  dataDir: Config.String("WIKI_AGENTS_DATA_DIR").pipe(
    Config.withDefault(join(xdgDataHome, "wiki-agents")),
  ),
  /** Built web app to serve. Unset in development, where Vite serves the UI. */
  staticDir: Config.option(Config.String("WIKI_AGENTS_STATIC_DIR")),
  migrationsDir: Config.String("WIKI_AGENTS_MIGRATIONS_DIR").pipe(
    Config.withDefault(fileURLToPath(new URL("../../drizzle", import.meta.url))),
  ),
} as const;
