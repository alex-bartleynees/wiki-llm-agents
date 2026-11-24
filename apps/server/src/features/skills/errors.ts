import { Data } from "effect";

export class SkillNotFound extends Data.TaggedError("SkillNotFound")<{ readonly message: string }> {}

export class SkillConflict extends Data.TaggedError("SkillConflict")<{ readonly message: string }> {}

export class SkillInvalid extends Data.TaggedError("SkillInvalid")<{ readonly message: string }> {}

export class SkillStorageError extends Data.TaggedError("SkillStorageError")<{ readonly cause: unknown }> {}

export type SkillProblem = SkillNotFound | SkillConflict | SkillInvalid;
export type SkillError = SkillProblem | SkillStorageError;

export const isSkillProblem = (error: unknown): error is SkillProblem =>
  error instanceof SkillNotFound || error instanceof SkillConflict || error instanceof SkillInvalid;
