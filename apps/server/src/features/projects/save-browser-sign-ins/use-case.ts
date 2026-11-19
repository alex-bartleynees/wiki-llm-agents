import { type BrowserSignIn, browserSignInProblems, originOf } from "@wiki-agents/contracts/projects/model";
import type { SaveBrowserSignInsRequest } from "@wiki-agents/contracts/projects/save-browser-sign-ins/request";
import type { SaveBrowserSignInsResponse } from "@wiki-agents/contracts/projects/save-browser-sign-ins/response";
import { Effect } from "effect";
import { InvalidProject } from "../errors.js";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

/** Names and secrets trimmed, sites as origins (`http://localhost:3000/login` → `http://localhost:3000`), each once. */
const normalised = (signIn: BrowserSignIn): BrowserSignIn => ({
  name: signIn.name.trim(),
  origins: [...new Set(signIn.origins.map((origin) => origin.trim()).filter((origin) => origin !== "").map((origin) => originOf(origin) ?? origin))],
  credentials: signIn.credentials.map((credential) => ({ variable: credential.variable.trim(), secret: credential.secret.trim() })),
});

/**
 * Replaces the project's browser sign-ins, failing with every problem. Secrets are
 * named, not checked: one that doesn't exist yet makes the browser say so when it starts.
 */
export const saveBrowserSignIns = Effect.fn("saveBrowserSignIns")(function* (projectId: string, request: SaveBrowserSignInsRequest) {
  const project = yield* findProject(projectId);
  const signIns = request.signIns.map(normalised);
  const problems = browserSignInProblems(signIns);
  if (problems.length > 0) return yield* new InvalidProject({ message: problems.join("\n") });
  const repository = yield* ProjectRepository;
  yield* repository.saveBrowserSignIns(project.id, signIns);
  return { signIns: yield* repository.browserSignIns(project.id) } satisfies SaveBrowserSignInsResponse;
});
