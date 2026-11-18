import { describe, expect, it } from "vitest";
import type { Step } from "./transcript.js";
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
    // Requests' ids only: a routed step's models have ids too, and repeat.
    const requestIds = (steps: ReadonlyArray<Step>): Array<string> =>
      steps.flatMap((step) =>
        step.type === "approval"
          ? [step.id, ...requestIds(step.approve), ...requestIds(step.deny)]
          : step.type === "question"
            ? [step.id, ...requestIds(step.then)]
            : [],
      );
    for (const transcript of TRANSCRIPTS) {
      const ids = requestIds(transcript.steps);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
