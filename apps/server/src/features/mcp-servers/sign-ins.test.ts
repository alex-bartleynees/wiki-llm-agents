import { describe, expect, it } from "vitest";
import { dotenvLine, signInsFingerprint } from "./sign-ins.js";

describe("dotenvLine", () => {
  it("quotes so Playwright's dotenv reads the value back exactly", () => {
    // Single quotes and backticks keep everything; double quotes would turn \n into a line break.
    expect(dotenvLine("PW", 'p#a"ss\\n w`rd ')).toBe("PW='p#a\"ss\\n w`rd '");
    expect(dotenvLine("PW", "it's")).toBe("PW=`it's`");
    expect(dotenvLine("PW", "it's `x`")).toBe('PW="it\'s `x`"');
  });

  it("gives up on a value no quoting keeps", () => {
    expect(dotenvLine("PW", "'`\"")).toBeNull();
    expect(dotenvLine("PW", "'`\\n")).toBeNull();
  });
});

describe("signInsFingerprint", () => {
  const signIn = { name: "Demo", origins: ["http://localhost:4200"], credentials: [{ variable: "DEMO_PASSWORD", secret: "demo-password" }] };

  it("changes with the credentials, not the sites or names", () => {
    expect(signInsFingerprint([signIn])).toBe(signInsFingerprint([{ ...signIn, name: "Other", origins: [] }]));
    expect(signInsFingerprint([signIn])).not.toBe(signInsFingerprint([{ ...signIn, credentials: [{ variable: "DEMO_PASSWORD", secret: "other" }] }]));
    expect(signInsFingerprint([])).not.toBe(signInsFingerprint([signIn]));
  });
});
