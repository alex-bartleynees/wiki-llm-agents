import type { PlanStep } from "@wiki-agents/contracts/threads/model";

/** Step statuses as providers write them (Codex says `inProgress`), in the app's terms. */
const STATUSES: Readonly<Record<string, PlanStep["status"]>> = {
  pending: "pending",
  in_progress: "in_progress",
  inProgress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
};

/** A step from a provider's text and status; undefined when either isn't usable. */
export const planStep = (text: unknown, status: unknown): PlanStep | undefined => {
  if (typeof text !== "string" || text.trim() === "" || typeof status !== "string") return undefined;
  const known = STATUSES[status];
  return known === undefined ? undefined : { text: text.trim(), status: known };
};

/**
 * The steps of a todo tool's input, `{ todos: [{ content, status }] }` (Claude Code's
 * `TodoWrite`, OpenCode's `todowrite`); undefined when the input isn't one, so the
 * call shows as an ordinary tool instead. An empty list clears the plan.
 */
export const todoSteps = (input: unknown): ReadonlyArray<PlanStep> | undefined => {
  const todos = typeof input === "object" && input !== null ? (input as { readonly todos?: unknown }).todos : undefined;
  if (!Array.isArray(todos)) return undefined;
  const steps = todos.map((todo: unknown) =>
    typeof todo === "object" && todo !== null ? planStep((todo as { content?: unknown }).content, (todo as { status?: unknown }).status) : undefined,
  );
  return steps.every((step): step is PlanStep => step !== undefined) ? steps : undefined;
};
