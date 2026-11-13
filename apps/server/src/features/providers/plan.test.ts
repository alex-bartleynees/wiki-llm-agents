import { describe, expect, it } from "vitest";
import { planStep, todoSteps } from "./plan.js";

describe("todoSteps", () => {
  it("reads a todo list, with Codex's inProgress taken as in progress", () => {
    expect(
      todoSteps({
        todos: [
          { content: "Read the notes", status: "completed", activeForm: "Reading the notes" },
          { content: " Draft ", status: "in_progress", priority: "high" },
          { content: "Tidy up", status: "cancelled" },
          { content: "File it", status: "pending" },
        ],
      }),
    ).toEqual([
      { text: "Read the notes", status: "completed" },
      { text: "Draft", status: "in_progress" },
      { text: "Tidy up", status: "cancelled" },
      { text: "File it", status: "pending" },
    ]);
    expect(planStep("Go", "inProgress")).toEqual({ text: "Go", status: "in_progress" });
  });

  it("takes an empty list as no plan, and anything else as not a todo list", () => {
    expect(todoSteps({ todos: [] })).toEqual([]);
    expect(todoSteps({ todos: [{ content: "Go", status: "someday" }] })).toBeUndefined();
    expect(todoSteps({ todos: [{ content: "", status: "pending" }] })).toBeUndefined();
    expect(todoSteps({ todos: "Go" })).toBeUndefined();
    expect(todoSteps(undefined)).toBeUndefined();
  });
});
