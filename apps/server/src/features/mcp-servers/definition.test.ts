import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { parseMcpServer, referenceProblems } from "./definition.js";

const parse = (text: string, id = "github") => parseMcpServer(id, `/config/mcp/${id}.yaml`, text);
const problems = (text: string, id?: string) => {
  const parsed = parse(text, id);
  return Result.isFailure(parsed) ? parsed.failure : [];
};

describe("parseMcpServer", () => {
  it("reads an http server, filling in what the file leaves out", () => {
    const parsed = parse("transport:\n  type: http\n  url: https://api.githubcopilot.com/mcp/\n  headers:\n    Authorization: Bearer ${secret:github}\n");
    expect(Result.getOrThrow(parsed)).toEqual({
      id: "github",
      path: "/config/mcp/github.yaml",
      title: "Github",
      transport: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${secret:github}" } },
      scope: "app",
      default: false,
      access: null,
    });
  });

  it("reads a stdio server with every setting", () => {
    const parsed = parse(
      "title: Browser\ntransport:\n  type: stdio\n  command: npx\n  args: [-y, '@playwright/mcp']\n  env:\n    TOKEN: ${env:BROWSER_TOKEN}\n  cwd: /srv/browser\nscope: thread\ndefault: true\naccess: ask\n",
      "my-browser",
    );
    expect(Result.getOrThrow(parsed)).toMatchObject({
      id: "my-browser",
      title: "Browser",
      transport: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp"], env: { TOKEN: "${env:BROWSER_TOKEN}" }, cwd: "/srv/browser" },
      scope: "thread",
      default: true,
      access: "ask",
    });
  });

  it.each([
    ["no transport", "title: GitHub\n", ["transport: Say how to reach the server: `type: stdio` with a `command`, or `type: http` with a `url`."]],
    ["an unknown transport", "transport:\n  type: sse\n", ["transport.type: Set it to `stdio` (a command the app runs) or `http` (a URL)."]],
    ["a list", "- a\n- b\n", ["The file must be a set of `key: value` lines."]],
    ["a misspelt setting", "transport:\n  type: stdio\n  comand: npx\n", ["transport.comand: Unknown setting; check the spelling.", "transport.command: Missing key"]],
    ["a setting of the other transport", "transport:\n  type: http\n  url: https://example.com/mcp\n  command: npx\n", ["transport.command: Unknown setting; check the spelling."]],
    ["an address that isn't http", "transport:\n  type: http\n  url: ftp://example.com\n", ["transport.url: An http:// or https:// address."]],
    ["an unknown scope", "transport:\n  type: http\n  url: https://example.com/mcp\nscope: vault\n", [expect.stringMatching(/^scope: /)]],
    ["a number where text is needed", "transport:\n  type: stdio\n  command: serve\n  env:\n    PORT: 8080\n", [expect.stringMatching(/^transport\.env\.PORT: /)]],
    ["an unknown reference", "transport:\n  type: http\n  url: https://example.com/mcp\n  headers:\n    Authorization: Bearer ${vault:github}\n", [expect.stringMatching(/^transport\.headers\.Authorization: \$\{vault:github\} isn't a reference the app knows/)]],
  ])("refuses %s", (_what, text, expected) => {
    expect(problems(text)).toEqual(expected);
  });

  it("refuses a file name that isn't an id", () => {
    expect(problems("transport:\n  type: http\n  url: https://example.com/mcp\n", "My Server")).toEqual([
      'The file name must be lowercase letters, digits and hyphens (got "My Server.yaml").',
    ]);
  });

  it("says where the YAML is wrong", () => {
    expect(problems("transport: [\n")[0]).toMatch(/^The file isn't valid YAML: /);
  });
});

describe("referenceProblems", () => {
  it.each([
    ["Bearer ${secret:github}", 0],
    ["${env:GITHUB_TOKEN}", 0],
    ["${file:/run/secrets/github}", 0],
    ["plain text with $HOME and {braces}", 0],
    ["${secret:Git Hub}", 1],
    ["${env:1BAD}", 1],
    ["${file:relative/path}", 1],
    ["${secret}", 1],
    ["${env:A} ${nope:b} ${file:c}", 2],
  ])("%s", (value, count) => {
    expect(referenceProblems("field", value)).toHaveLength(count);
  });
});
