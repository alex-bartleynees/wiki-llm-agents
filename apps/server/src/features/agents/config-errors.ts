import { HttpServerResponse } from "effect/http";

/**
 * 422 for an agent or rules file the app would refuse to load: one problem per
 * line, each starting with its field (`name: …`) when it has one.
 */
export const unprocessable = (problems: ReadonlyArray<string>) => HttpServerResponse.text(problems.join("\n"), { status: 422 });
