import { Effect, Layer, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpRouter } from "effect/http";
import { AppConfig } from "../shared/config.js";
import { badRequest, internalError } from "../shared/http-errors.js";
import { WallClock } from "../shared/wall-clock.js";

/** POST /api/test/clock: moves the schedules' clock forward by `advanceMs`. */
const AdvanceClockRequest = Schema.Struct({ advanceMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)) });

const advanceClockEndpoint = Effect.gen(function* () {
  const { advanceMs } = yield* HttpServerRequest.schemaBodyJson(AdvanceClockRequest);
  const clock = yield* WallClock;
  yield* clock.advance(advanceMs);
  return HttpServerResponse.jsonUnsafe({ now: yield* clock.now });
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()), HttpServerError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("advance clock")),
);

/**
 * Routes for end-to-end tests, served only with `WIKI_AGENTS_TEST_HOOKS=true`: a
 * browser test drives the server's clock instead of sleeping.
 */
export const testHooksRouter = Layer.unwrap(
  Effect.map(AppConfig.testHooks, (enabled) => (enabled ? HttpRouter.add("POST", "/api/test/clock", advanceClockEndpoint) : Layer.empty)),
);
