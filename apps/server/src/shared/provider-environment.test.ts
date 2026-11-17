import { describe, expect, it } from "vitest";
import { parseNames, providerEnvironment } from "./provider-environment.js";

const source = {
  PATH: "/usr/bin",
  HOME: "/home/me",
  SSH_AUTH_SOCK: "/run/user/1000/ssh-agent",
  NIX_PATH: "nixpkgs=/nix",
  ANTHROPIC_API_KEY: "sk-ant",
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  AWS_REGION: "ap-southeast-2",
  NPM_TOKEN: "npm-secret",
  WIKI_AGENTS_DATA_DIR: "/data",
  WIKI_AGENTS_VAPID_KEYS_FILE: "/run/secrets/vapid",
  UNSET: undefined,
};

describe("providerEnvironment", () => {
  it("passes everything but the app's own settings by default", () => {
    expect(providerEnvironment(source, { withhold: [], pass: [] })).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      SSH_AUTH_SOCK: "/run/user/1000/ssh-agent",
      NIX_PATH: "nixpkgs=/nix",
      ANTHROPIC_API_KEY: "sk-ant",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      AWS_REGION: "ap-southeast-2",
      NPM_TOKEN: "npm-secret",
    });
  });

  it("withholds named variables and prefixes", () => {
    const env = providerEnvironment(source, { withhold: ["AWS_*", "NPM_TOKEN"], pass: [] });
    expect(Object.keys(env)).toEqual(["PATH", "HOME", "SSH_AUTH_SOCK", "NIX_PATH", "ANTHROPIC_API_KEY"]);
  });

  it("passes a named variable over a withheld prefix and over the app's own", () => {
    const env = providerEnvironment(source, { withhold: ["AWS_*"], pass: ["AWS_REGION", "WIKI_AGENTS_DATA_DIR"] });
    expect(env.AWS_REGION).toBe("ap-southeast-2");
    expect(env.WIKI_AGENTS_DATA_DIR).toBe("/data");
    expect(env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(env).not.toHaveProperty("WIKI_AGENTS_VAPID_KEYS_FILE");
  });

  it("never passes the secrets' settings, even when named", () => {
    const secrets = { ...source, WIKI_AGENTS_SECRETS_KEY_FILE: "/state/secrets.key", WIKI_AGENTS_SECRET_FILES: "github=/run/secrets/github" };
    const env = providerEnvironment(secrets, { withhold: [], pass: ["WIKI_AGENTS_*", "WIKI_AGENTS_SECRETS_KEY_FILE", "WIKI_AGENTS_SECRET_FILES"] });
    expect(env.WIKI_AGENTS_DATA_DIR).toBe("/data");
    expect(env).not.toHaveProperty("WIKI_AGENTS_SECRETS_KEY_FILE");
    expect(env).not.toHaveProperty("WIKI_AGENTS_SECRET_FILES");
  });

  it("matches a name exactly unless it ends with *", () => {
    const env = providerEnvironment(source, { withhold: ["AWS"], pass: [] });
    expect(env.AWS_REGION).toBe("ap-southeast-2");
  });
});

describe("parseNames", () => {
  it.each([
    ["", []],
    ["  ", []],
    ["NPM_TOKEN", ["NPM_TOKEN"]],
    ["AWS_*, NPM_TOKEN", ["AWS_*", "NPM_TOKEN"]],
    ["AWS_* NPM_TOKEN,,GH_TOKEN ", ["AWS_*", "NPM_TOKEN", "GH_TOKEN"]],
  ])("%j", (value, names) => {
    expect(parseNames(value)).toEqual(names);
  });
});
