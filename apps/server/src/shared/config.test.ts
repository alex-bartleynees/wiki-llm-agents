import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { AppConfig } from "./config.js";

describe("AppConfig", () => {
  it.effect("makes relative folders absolute, from the working directory (as `npm run dev` sets them)", () =>
    Effect.gen(function* () {
      const [dataDir, configDir, keyFile] = yield* Effect.all([AppConfig.dataDir, AppConfig.configDir, AppConfig.secretsKeyFile]).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ WIKI_AGENTS_DATA_DIR: "../../.data", WIKI_AGENTS_CONFIG_DIR: "config", WIKI_AGENTS_SECRETS_KEY_FILE: "/keys/secrets.key" }),
          ),
        ),
      );
      // Codex refuses a relative path in its permission profile ("must be absolute").
      expect(dataDir).toBe(resolve("../../.data"));
      expect(configDir).toBe(resolve("config"));
      expect(keyFile).toBe("/keys/secrets.key");
      expect([dataDir, configDir].every((path) => isAbsolute(path))).toBe(true);
    }),
  );
});
