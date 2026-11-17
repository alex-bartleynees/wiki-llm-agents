import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type ReferenceSources, resolveReferences } from "./references.js";

const sources: ReferenceSources = {
  secret: (name) => (name === "github" ? Effect.succeed("ghp_token") : Effect.fail({ reason: `There is no secret "${name}".` })),
  env: { HOME_TOKEN: "env-token" },
  readFile: (path) => (path === "/run/secrets/x" ? Effect.succeed("file-token\n") : Effect.fail(new Error("ENOENT"))),
};
const resolve = (values: Record<string, string>) => Effect.runSync(Effect.result(resolveReferences(sources, "transport.headers", values)));

describe("resolveReferences", () => {
  it("fills in each kind, keeping the text around them, and lists the values used", () => {
    const resolved = resolve({ Authorization: "Bearer ${secret:github}", "X-Env": "${env:HOME_TOKEN}", "X-File": "a ${file:/run/secrets/x} b", Plain: "plain" });
    expect(resolved).toMatchObject({
      _tag: "Success",
      success: {
        values: { Authorization: "Bearer ghp_token", "X-Env": "env-token", "X-File": "a file-token b", Plain: "plain" },
        used: ["ghp_token", "env-token", "file-token"],
      },
    });
  });

  it("names the reference that can't be filled in, never a value", () => {
    expect(resolve({ A: "${secret:nope}" })).toMatchObject({ failure: { reason: 'transport.headers.A: There is no secret "nope".' } });
    expect(resolve({ B: "${env:MISSING}" })).toMatchObject({ failure: { reason: "transport.headers.B: ${env:MISSING} isn't set in the app's environment." } });
    expect(resolve({ C: "${file:/nowhere}" })).toMatchObject({ failure: { reason: "transport.headers.C: ${file:/nowhere} can't be read." } });
  });
});
