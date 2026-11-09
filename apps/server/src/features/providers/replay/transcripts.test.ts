import { describe, expect, it } from "vitest";
import { chooseTranscript, TRANSCRIPTS } from "./transcripts.js";

describe("chooseTranscript", () => {
  it.each([
    ["What is this vault about?", "simple"],
    ["Please EDIT the plan", "approval"],
    ["ask me something", "question"],
    ["write a long answer", "long"],
    ["make it fail", "fail"],
    ["reedit", "simple"],
  ])("%s → %s", (text, name) => {
    expect(chooseTranscript(text).name).toBe(name);
  });

  it("uses unique request ids within each transcript", () => {
    for (const transcript of TRANSCRIPTS) {
      const ids = JSON.stringify(transcript.steps).match(/"id":"[^"]+"/g) ?? [];
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
