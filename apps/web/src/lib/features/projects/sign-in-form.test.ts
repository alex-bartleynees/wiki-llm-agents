import { describe, expect, it } from "vitest";
import { blankSignIn, signInFromForm, signInToForm, variablePrefix } from "./sign-in-form.ts";

describe("sign-in form", () => {
  const signIn = { name: "Demo local", origins: ["http://localhost:4200", "https://login.example.com"], credentials: [{ variable: "DEMO_PASSWORD", secret: "demo-password" }] };

  it("round-trips a saved sign-in", () => {
    expect(signInFromForm(signInToForm(signIn))).toEqual(signIn);
  });

  it("leaves out blank sites and credential rows", () => {
    const form = { ...signInToForm(signIn), origins: "\n http://localhost:4200 \n\n" };
    form.credentials.push({ key: "k", variable: " ", secret: "" });
    expect(signInFromForm(form)).toEqual({ ...signIn, origins: ["http://localhost:4200"] });
  });

  it("suggests a username and password named after the site", () => {
    expect(variablePrefix("Demo local")).toBe("DEMO_LOCAL");
    expect(variablePrefix("4200 admin-portal!")).toBe("ADMIN_PORTAL");
    const blank = blankSignIn("Demo local", "http://localhost:4200");
    expect(signInFromForm(blank)).toEqual({ name: "Demo local", origins: ["http://localhost:4200"], credentials: [{ variable: "DEMO_LOCAL_USER", secret: "" }, { variable: "DEMO_LOCAL_PASSWORD", secret: "" }] });
    expect(signInFromForm(blankSignIn("", "")).credentials).toEqual([]);
  });
});
