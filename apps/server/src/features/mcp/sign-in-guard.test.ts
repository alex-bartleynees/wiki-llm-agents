import { browserSignInProblems } from "@wiki-agents/contracts/projects/model";
import { describe, expect, it } from "vitest";
import { askingLevel, pageUrlOf, signInRefusal, typedCredentials } from "./sign-in-guard.js";

const DEMO = {
  name: "Demo local",
  origins: ["http://localhost:4200", "https://login.example.com"],
  credentials: [
    { variable: "DEMO_USER", secret: "demo-user" },
    { variable: "DEMO_PASSWORD", secret: "demo-password" },
  ],
};

describe("typedCredentials", () => {
  it("finds a name typed whole, as Playwright looks it up", () => {
    expect(typedCredentials("browser_type", { ref: "e1", text: "DEMO_PASSWORD" }, [DEMO]).map(({ variable }) => variable)).toEqual(["DEMO_PASSWORD"]);
    expect(typedCredentials("browser_type", { text: "my DEMO_PASSWORD" }, [DEMO])).toEqual([]);
    const form = { fields: [{ name: "User", type: "textbox", value: "DEMO_USER" }, { name: "Password", type: "textbox", value: "DEMO_PASSWORD" }, { name: "Stay", type: "checkbox", value: "true" }] };
    expect(typedCredentials("browser_fill_form", form, [DEMO]).map(({ variable }) => variable)).toEqual(["DEMO_USER", "DEMO_PASSWORD"]);
  });

  it("ignores tools that don't type secrets", () => {
    expect(typedCredentials("browser_navigate", { url: "DEMO_PASSWORD" }, [DEMO])).toEqual([]);
    expect(typedCredentials("browser_type", "DEMO_PASSWORD", [DEMO])).toEqual([]);
  });
});

describe("pageUrlOf", () => {
  it("reads the last page line of a browser result", () => {
    const result = { content: [{ type: "text", text: "### Page\n- Page URL: http://localhost:4200/a\n" }, { type: "text", text: "- Page URL: http://localhost:4200/b\n- Page Title: B" }] };
    expect(pageUrlOf(result)).toBe("http://localhost:4200/b");
    expect(pageUrlOf({ content: [{ type: "text", text: "Clicked" }] })).toBeNull();
    expect(pageUrlOf(null)).toBeNull();
  });
});

describe("signInRefusal", () => {
  const typed = typedCredentials("browser_type", { text: "DEMO_PASSWORD" }, [DEMO]);

  it("allows the sign-in's sites, by origin", () => {
    expect(signInRefusal(typed, "http://localhost:4200/login?next=/")).toBeNull();
    expect(signInRefusal(typed, "https://login.example.com/oauth")).toBeNull();
  });

  it("refuses anywhere else, and before the browser has said where it is", () => {
    expect(signInRefusal(typed, "http://localhost:4201/login")).toContain("DEMO_PASSWORD may only be typed on http://localhost:4200 or https://login.example.com");
    expect(signInRefusal(typed, "http://localhost:4200.evil.example/")).not.toBeNull();
    expect(signInRefusal(typed, "about:blank")).not.toBeNull();
    expect(signInRefusal(typed, null)).toContain("hasn't reported a page yet");
  });
});

describe("askingLevel", () => {
  it("asks instead of allowing, and still denies", () => {
    expect([askingLevel("allow"), askingLevel("ask"), askingLevel("deny")]).toEqual(["ask", "ask", "deny"]);
  });
});

describe("browserSignInProblems", () => {
  it("accepts a sign-in with a name, a site and named secrets", () => {
    expect(browserSignInProblems([DEMO])).toEqual([]);
  });

  it("refuses a name used by two sign-ins, which would type either secret", () => {
    expect(browserSignInProblems([DEMO, { ...DEMO, name: "Copy" }])).toEqual(['"Copy": DEMO_USER is used twice; each name may stand for one secret.', '"Copy": DEMO_PASSWORD is used twice; each name may stand for one secret.']);
  });

  it("refuses short or lowercase names, which ordinary typing could hit", () => {
    const problems = browserSignInProblems([{ ...DEMO, credentials: [{ variable: "PW", secret: "pw" }, { variable: "password", secret: "pw" }] }]);
    expect(problems).toHaveLength(2);
  });
});
