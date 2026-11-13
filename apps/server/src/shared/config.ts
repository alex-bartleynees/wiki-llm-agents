import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Config } from "effect";

const xdgDataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");

/** Process configuration. Every value has a default so `wiki-agents` starts with no setup. */
export const AppConfig = {
  /** Loopback only; remote access comes later with authentication. */
  host: Config.String("WIKI_AGENTS_HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.Port("WIKI_AGENTS_PORT").pipe(Config.withDefault(4317)),
  dataDir: Config.String("WIKI_AGENTS_DATA_DIR").pipe(
    Config.withDefault(join(xdgDataHome, "wiki-agents")),
  ),
  /** Rules and agent definitions (`rules/*.md`, `agents/*.md`), seeded on first start. */
  configDir: Config.String("WIKI_AGENTS_CONFIG_DIR").pipe(Config.withDefault(join(xdgConfigHome, "wiki-agents"))),
  /** Built web app to serve. Unset in development, where Vite serves the UI. */
  staticDir: Config.option(Config.String("WIKI_AGENTS_STATIC_DIR")),
  /**
   * Check vault files every this many milliseconds instead of waiting for file system
   * events, for vaults whose changes the OS doesn't report (a folder shared into a VM).
   */
  watchPollMs: Config.option(Config.Int("WIKI_AGENTS_WATCH_POLL_MS")),
  /** The OpenCode executable: a path, or a name looked up on `PATH`. */
  opencodeBinary: Config.String("WIKI_AGENTS_OPENCODE").pipe(Config.withDefault("opencode")),
  /** The Claude Code executable: a path, or a name looked up on `PATH`. */
  claudeBinary: Config.String("WIKI_AGENTS_CLAUDE").pipe(Config.withDefault("claude")),
  /** The Codex executable: a path, or a name looked up on `PATH`. */
  codexBinary: Config.String("WIKI_AGENTS_CODEX").pipe(Config.withDefault("codex")),
  /** The timezone a new schedule's times are in unless it says otherwise (IANA name). */
  timezone: Config.String("WIKI_AGENTS_TIMEZONE").pipe(Config.withDefault("Pacific/Auckland")),
  /**
   * A JSON file with the Web Push VAPID key pair (`{"publicKey": "...", "privateKey":
   * "..."}`, base64url), for keys kept in service secrets. Unset: a pair is made on
   * first start and kept in the database.
   */
  vapidKeysFile: Config.option(Config.String("WIKI_AGENTS_VAPID_KEYS_FILE")),
  /** Who push services can contact about this sender: a `mailto:` or `https:` URL. */
  vapidSubject: Config.String("WIKI_AGENTS_VAPID_SUBJECT").pipe(
    Config.withDefault("https://github.com/alex-bartleynees/wiki-llm-agents"),
  ),
  /**
   * End-to-end tests only: serves `POST /api/test/clock`, which moves the schedules'
   * clock forward so a browser test can make a schedule fire without waiting, and
   * adds the replay provider, which plays recorded turns without an agent installed.
   */
  testHooks: Config.Boolean("WIKI_AGENTS_TEST_HOOKS").pipe(Config.withDefault(false)),
  migrationsDir: Config.String("WIKI_AGENTS_MIGRATIONS_DIR").pipe(
    Config.withDefault(fileURLToPath(new URL("../../drizzle", import.meta.url))),
  ),
} as const;
