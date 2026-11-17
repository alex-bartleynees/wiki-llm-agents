import { describe, expect, it } from "vitest";
import { parseDeclaredSecrets } from "./declared.js";

describe("parseDeclaredSecrets", () => {
  it("reads name=/path entries separated by commas or new lines", () => {
    const { files, problems } = parseDeclaredSecrets("github=/run/secrets/github, jira = /run/secrets/my jira\ncoffee=/a=b\n");
    expect([...files]).toEqual([
      ["github", "/run/secrets/github"],
      ["jira", "/run/secrets/my jira"],
      ["coffee", "/a=b"],
    ]);
    expect(problems).toEqual([]);
  });

  it("is empty when unset", () => {
    expect(parseDeclaredSecrets("")).toEqual({ files: new Map(), problems: [] });
  });

  it("reports entries it can't use and keeps the rest", () => {
    const { files, problems } = parseDeclaredSecrets("GitHub=/x,github,jira=relative/path,ok=/ok");
    expect([...files.keys()]).toEqual(["ok"]);
    expect(problems).toHaveLength(3);
    expect(problems[2]).toBe('"jira=relative/path": give the file\'s full path.');
  });

  it("lets a later entry replace an earlier one", () => {
    expect([...parseDeclaredSecrets("a=/one,a=/two").files]).toEqual([["a", "/two"]]);
  });
});
