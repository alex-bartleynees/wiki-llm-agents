import { FinishConnectRequest } from "@wiki-agents/contracts/mcp-oauth/finish-connect/request";
import { FinishConnectResponse } from "@wiki-agents/contracts/mcp-oauth/finish-connect/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { guarded } from "../../../shared/host-guard.js";
import { badRequest, conflict, internalError } from "../../../shared/http-errors.js";
import { McpConnections, type SignInAnswer } from "../connections.js";

/** The identity server's answer in a pasted address, or null when it isn't an address. */
const answerIn = (pasted: string): SignInAnswer | null => {
  try {
    const query = new URL(pasted.trim()).searchParams;
    return { code: query.get("code"), state: query.get("state"), error: query.get("error"), errorDescription: query.get("error_description") };
  } catch {
    return null;
  }
};

/** Finishes a sign-in from the address the identity server sent you to, pasted in Settings. Failures are logged without the request. */
export const finishConnectEndpoint = guarded(
  Effect.gen(function* () {
    const { url } = yield* HttpServerRequest.schemaBodyJson(FinishConnectRequest);
    const answer = answerIn(url);
    if (answer === null) return badRequest("Paste the whole address, starting with http:// or https://.");
    return yield* HttpServerResponse.schemaJson(FinishConnectResponse)({ connection: yield* (yield* McpConnections).finish(answer) });
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(badRequest()),
      SignInUnknown: (error) => Effect.succeed(conflict(error.reason)),
      SignInFailed: (error) => Effect.succeed(conflict(error.reason)),
      GrantRejected: (error) => Effect.succeed(conflict(error.reason)),
      SecretStoreUnavailable: (error) => Effect.succeed(conflict(error.reason)),
    }),
    Effect.catch(() => internalError("finish MCP sign-in")("(details withheld)")),
  ),
);
