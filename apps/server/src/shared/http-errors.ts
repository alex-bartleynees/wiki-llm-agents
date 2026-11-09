import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";

export const badRequest = (message = "Invalid request") => HttpServerResponse.text(message, { status: 400 });

export const notFound = (message = "Not found") => HttpServerResponse.text(message, { status: 404 });

/** Logs the unexpected failure and answers 500 without leaking its details. */
export const internalError = (operation: string) => (cause: unknown) =>
  Effect.andThen(
    Effect.logError(`${operation} failed`, cause),
    Effect.succeed(HttpServerResponse.text("Internal server error", { status: 500 })),
  );

/** The request is valid but conflicts with the current state (a turn is running...). */
export const conflict = (message: string) => HttpServerResponse.text(message, { status: 409 });
