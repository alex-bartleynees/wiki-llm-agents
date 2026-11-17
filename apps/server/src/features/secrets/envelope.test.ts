import { describe, expect, it } from "vitest";
import { DEK_CONTEXT, newKey, open, seal, secretContext } from "./envelope.js";

const text = (value: Buffer | undefined) => value?.toString("utf8");

describe("seal and open", () => {
  it("round-trips, with a fresh nonce each time", () => {
    const key = newKey();
    const first = seal(key, secretContext("github"), Buffer.from("ghp_token"));
    const second = seal(key, secretContext("github"), Buffer.from("ghp_token"));
    expect(text(open(key, secretContext("github"), first))).toBe("ghp_token");
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(Buffer.from(first.ciphertext, "base64").toString("latin1")).not.toContain("ghp_token");
  });

  it("refuses another key, another name, or changed data", () => {
    const key = newKey();
    const sealed = seal(key, secretContext("github"), Buffer.from("ghp_token"));
    expect(open(newKey(), secretContext("github"), sealed)).toBeUndefined();
    expect(open(key, secretContext("jira"), sealed)).toBeUndefined();
    expect(open(key, DEK_CONTEXT, sealed)).toBeUndefined();
    const data = Buffer.from(sealed.ciphertext, "base64");
    data[0] = data[0]! ^ 1;
    expect(open(key, secretContext("github"), { ...sealed, ciphertext: data.toString("base64") })).toBeUndefined();
    expect(open(key.subarray(0, 16), secretContext("github"), sealed)).toBeUndefined();
    expect(open(key, secretContext("github"), { nonce: sealed.nonce, ciphertext: "" })).toBeUndefined();
  });
});
