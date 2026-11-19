import { originOf } from "@wiki-agents/contracts/projects/model";
import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/ai";
import { ProjectRepository } from "../../../projects/repository.js";
import { ThreadActors } from "../../../threads/thread-actors.js";
import { ThreadRepository } from "../../../threads/repository.js";
import { VaultCaller } from "../../auth.js";
import { Notices, ToolFailure, vaultTool } from "../shared.js";

export const BrowserSignInNeeded = vaultTool(
  Tool.make("browser_sign_in_needed", {
    description:
      "Call when a page in the built-in browser wants a sign-in this project doesn't have. It shows the user a card linking to the project's browser sign-ins, where they add a test account (stored as secrets, never typed in the conversation). Never ask for a password, code or token in the conversation instead. Then stop and tell the user; the sign-in reaches the browser on the next turn after they add it.",
    parameters: Schema.Struct({
      site: Schema.String.check(Schema.isNonEmpty()).annotate({ description: 'What to call the site, e.g. "My app (local)".' }),
      url: Schema.String.check(Schema.isNonEmpty()).annotate({ description: "The page that wants the sign-in, e.g. http://localhost:3000/login." }),
      reason: Schema.optionalKey(Schema.String.annotate({ description: "Why you need to sign in, in a sentence, for the user." })),
    }),
    success: Schema.Struct({
      /** Whether the card was shown: not when the project already has a sign-in for the site. */
      shown: Schema.Boolean,
      notices: Notices,
    }),
    failure: ToolFailure,
    dependencies: [VaultCaller],
  }),
  // It shows the user a card; it changes nothing.
).annotate(Tool.Idempotent, true);

/** Longest site name or reason shown on the card. */
const MAX_TEXT = 200;

export const browserSignInNeeded = Effect.fnUntraced(
  function* (params: typeof BrowserSignInNeeded.parametersSchema.Type) {
    const { threadId } = yield* VaultCaller;
    const thread = yield* (yield* ThreadRepository).find(threadId);
    const projectId = Option.getOrNull(Option.flatMapNullishOr(thread, (summary) => summary.projectId));
    if (projectId === null) {
      return yield* new ToolFailure({ message: "Browser sign-ins belong to projects, and this thread isn't in one. Tell the user the page wants a sign-in; they can start the thread in the project instead." });
    }
    const origin = originOf(params.url);
    if (origin === null) return yield* new ToolFailure({ message: `"${params.url}" isn't an http:// or https:// address.` });
    const projects = yield* ProjectRepository;
    const existing = (yield* projects.browserSignIns(projectId)).find((signIn) => signIn.origins.includes(origin));
    if (existing !== undefined) {
      return {
        shown: false,
        notices: [
          `The project already has the sign-in "${existing.name}" for ${origin}: type ${existing.credentials.map((credential) => credential.variable).join(", ")}. If the browser typed the name itself, the sign-in was added during this turn: it reaches the browser on the next one, so stop and tell the user.`,
        ],
      };
    }
    const site = params.site.trim().slice(0, MAX_TEXT);
    const reason = params.reason?.trim().slice(0, MAX_TEXT) || null;
    const href = `/projects/${encodeURIComponent(projectId)}?${new URLSearchParams({ "add-sign-in": site, origin }).toString()}#browser-sign-ins`;
    yield* (yield* ThreadActors).signInNeeded(threadId, { projectId, site, origin, reason, href });
    return {
      shown: true,
      notices: [`The user was shown a card to add a sign-in for ${site} (${origin}) to the project. Stop here and say so; continue when they tell you it's added.`],
    };
  },
  Effect.catchTags({
    DbError: () => Effect.fail(new ToolFailure({ message: "The project's sign-ins couldn't be read just now." })),
    NoTurnRunning: () => Effect.fail(new ToolFailure({ message: "The card can only be shown during a turn." })),
    ProjectNotFound: () => Effect.fail(new ToolFailure({ message: "This thread's project no longer exists." })),
    ThreadNotFound: () => Effect.fail(new ToolFailure({ message: "This thread no longer exists." })),
    VaultNotFound: () => Effect.fail(new ToolFailure({ message: "This thread's vault is no longer registered." })),
  }),
);
