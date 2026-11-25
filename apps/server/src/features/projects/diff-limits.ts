import type { DiffLimits } from "./git/index.js";

/** Each file in the project's diff: enough to review most changes in place. */
export const LIST_LIMITS: DiffLimits = { lines: 1500, chars: 120_000 };
export const FILE_LIMITS: DiffLimits = { lines: 20_000, chars: 2_000_000 };
/** Diff text in one project diff; files past it come without their diff, to load one at a time. */
export const LIST_BUDGET_CHARS = 4_000_000;
