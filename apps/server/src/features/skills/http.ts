import { Effect } from "effect";
import { badRequest, conflict, internalError, notFound, unprocessable } from "../../shared/http-errors.js";
import { SkillProblem } from "./problem.js";

export const skillErrors = (operation: string) => Effect.catch((error: unknown) => {
  if (error instanceof SkillProblem) {
    if (error.status === 409) return Effect.succeed(conflict(error.message));
    if (error.status === 404) return Effect.succeed(notFound(error.message));
    return Effect.succeed(unprocessable([error.message]));
  }
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "SchemaError") {
    return Effect.succeed(badRequest());
  }
  return internalError(operation)(error);
});
