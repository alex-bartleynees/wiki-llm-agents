import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizationServerUrls, authorizationUrl, bearerChallenge, chooseScopes, insecureUrlProblem, pkcePair, protectedResourceUrls, resourceMatches } from "./protocol.js";

describe("bearerChallenge", () => {
  it("reads the coffee journal's challenge", () => {
    const params = bearerChallenge('Bearer resource_metadata="https://app.coffeesjournal.com/.well-known/oauth-protected-resource/mcp", scope="coffee-journal:read"');
    expect(params?.get("resource_metadata")).toBe("https://app.coffeesjournal.com/.well-known/oauth-protected-resource/mcp");
    expect(params?.get("scope")).toBe("coffee-journal:read");
  });

  it("takes unquoted values, escapes and any case", () => {
    const params = bearerChallenge('Basic realm="x", bearer Error=invalid_token, error_description="say \\"hi\\""');
    expect(params?.get("error")).toBe("invalid_token");
    expect(params?.get("error_description")).toBe('say "hi"');
  });

  it("is null for no header or another scheme", () => {
    expect(bearerChallenge(null)).toBeNull();
    expect(bearerChallenge('Basic realm="x"')).toBeNull();
  });
});

describe("metadata addresses", () => {
  it("tries the named address, then the well-known ones with and without the path", () => {
    expect(protectedResourceUrls("https://app.coffeesjournal.com/mcp", null)).toEqual([
      "https://app.coffeesjournal.com/.well-known/oauth-protected-resource/mcp",
      "https://app.coffeesjournal.com/.well-known/oauth-protected-resource",
    ]);
    expect(protectedResourceUrls("https://api.githubcopilot.com/mcp/", "https://x/meta")).toEqual([
      "https://x/meta",
      "https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp",
      "https://api.githubcopilot.com/.well-known/oauth-protected-resource",
    ]);
    expect(protectedResourceUrls("https://h/", null)).toEqual(["https://h/.well-known/oauth-protected-resource"]);
  });

  it("finds Keycloak's realm metadata among the issuer's candidates", () => {
    expect(authorizationServerUrls("https://identity.alexbartleynees.com/realms/production")).toEqual([
      "https://identity.alexbartleynees.com/.well-known/oauth-authorization-server/realms/production",
      "https://identity.alexbartleynees.com/.well-known/openid-configuration/realms/production",
      "https://identity.alexbartleynees.com/realms/production/.well-known/openid-configuration",
    ]);
    expect(authorizationServerUrls("https://auth.atlassian.com")).toEqual([
      "https://auth.atlassian.com/.well-known/oauth-authorization-server",
      "https://auth.atlassian.com/.well-known/openid-configuration",
    ]);
  });
});

describe("insecureUrlProblem", () => {
  it.each([
    ["https://identity.example.com/token", null],
    ["http://127.0.0.1:8080/token", null],
    ["http://localhost/token", null],
    ["http://[::1]/token", null],
    ["http://identity.example.com/token", "isn't HTTPS"],
    ["not a url", "isn't an address"],
    [undefined, "gave no"],
  ])("%s", (value, problem) => {
    const found = insecureUrlProblem(value, "token endpoint");
    if (problem === null) expect(found).toBeNull();
    else expect(found).toContain(problem);
  });
});

describe("chooseScopes", () => {
  it("adds offline_access to the configured scopes when it is offered, as Netclaw did", () => {
    expect(chooseScopes({ configured: ["coffee-journal:read"], challenged: "other", advertised: ["x"], offered: ["openid", "offline_access"] })).toEqual([
      "coffee-journal:read",
      "offline_access",
    ]);
  });

  it("falls back to the challenge's scopes, then the advertised ones", () => {
    expect(chooseScopes({ configured: [], challenged: "a b", advertised: ["c"], offered: [] })).toEqual(["a", "b"]);
    expect(chooseScopes({ configured: [], challenged: null, advertised: ["c"], offered: [] })).toEqual(["c"]);
    expect(chooseScopes({ configured: [], challenged: null, advertised: [], offered: [] })).toEqual([]);
  });
});

describe("authorizationUrl", () => {
  it("asks for a code with PKCE S256, the state, scopes and the resource", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const url = new URL(
      authorizationUrl({
        endpoint: "https://identity.example.com/auth?prompt=consent",
        clientId: "coffee-journal-ai-agent",
        redirectUri: "http://127.0.0.1:4320/api/mcp-servers/oauth/callback",
        challenge,
        state: "s",
        scopes: ["coffee-journal:read", "offline_access"],
        resource: "https://app.coffeesjournal.com/mcp",
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      prompt: "consent",
      response_type: "code",
      client_id: "coffee-journal-ai-agent",
      redirect_uri: "http://127.0.0.1:4320/api/mcp-servers/oauth/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "s",
      scope: "coffee-journal:read offline_access",
      resource: "https://app.coffeesjournal.com/mcp",
    });
  });
});

describe("resourceMatches", () => {
  it.each([
    ["https://app.coffeesjournal.com/mcp", "https://app.coffeesjournal.com/mcp", true],
    ["https://api.githubcopilot.com/mcp", "https://api.githubcopilot.com/mcp/", true],
    ["https://h", "https://h/v1/mcp", true],
    ["https://h/v1", "https://h/v1/mcp", true],
    ["https://h/v1", "https://h/v10/mcp", false],
    ["https://other/mcp", "https://h/mcp", false],
  ])("%s for %s", (resource, server, matches) => {
    expect(resourceMatches(resource, server)).toBe(matches);
  });
});
