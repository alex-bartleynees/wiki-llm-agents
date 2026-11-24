import { Effect } from "effect";
import { badRequest, conflict, notFound, unprocessable } from "../../shared/http-errors.js";
import type { SkillConflict, SkillInvalid, SkillNotFound } from "./errors.js";

export const skillResponses = {
  SchemaError: () => Effect.succeed(badRequest()),
  SkillNotFound: (error: SkillNotFound) => Effect.succeed(notFound(error.message)),
  SkillConflict: (error: SkillConflict) => Effect.succeed(conflict(error.message)),
  SkillInvalid: (error: SkillInvalid) => Effect.succeed(unprocessable([error.message])),
};

export const skillBodyResponses = {
  ...skillResponses,
  HttpServerError: () => Effect.succeed(badRequest()),
};
