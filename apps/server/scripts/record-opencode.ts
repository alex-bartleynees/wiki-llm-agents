/**
 * Records real OpenCode 2 event streams as fixtures for the adapter tests
 * (`tests/fixtures/opencode/<scenario>.json`). Each scenario runs against a fresh
 * copy of a small vault in a temp folder, on OpenCode's default (free) model unless
 * `--model` says otherwise.
 *
 *   npm run record:opencode -w @wiki-agents/server -- [scenario...] [--model provider/model]
 *
 * With no scenario, records them all. Uses your installed `opencode` and its login;
 * nothing outside the temp folder is touched.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { OpenCodeEvent } from "@opencode/protocol/groups/event";
import { Effect, Option, PubSub, Schema } from "effect";
import { DENIED, SESSION_PERMISSIONS } from "../src/features/providers/opencode/adapter.js";
import type { OpenCodeApi, OpenCodeSignal } from "../src/features/providers/opencode/api.js";
import { sessionOf } from "../src/features/providers/opencode/events.js";
import { startServer } from "../src/features/providers/opencode/server.js";
import { type Fixture, type FixtureStep, VAULT, VAULT_FILES } from "../tests/fixtures/opencode/fixture.js";

const encode = Schema.encodeUnknownSync(OpenCodeEvent);
const outDir = fileURLToPath(new URL("../tests/fixtures/opencode/", import.meta.url));

/** How the recorder answers a request; `stop` interrupts the turn instead. */
type Answer = { readonly reply: "once" | "reject" } | { readonly text: string };

interface TurnScript {
  readonly prompt: string;
  readonly answer?: Answer;
  /** Interrupt straight after sending, or after the first text arrives. */
  readonly interrupt?: "after-send" | "after-text";
}

const SCENARIOS: Readonly<Record<string, ReadonlyArray<TurnScript>>> = {
  simple: [{ prompt: "Which notes are in this vault? List the file names in one short sentence." }],
  "multi-turn": [
    { prompt: "Remember the word 'kiwi'. Reply with just OK." },
    { prompt: "Which word did I ask you to remember? Reply with just the word." },
  ],
  "approval-approved": [
    { prompt: "Add the line 'Oolong too.' at the end of Notes/Tea.md. Keep the reply to one sentence.", answer: { reply: "once" } },
  ],
  "approval-denied": [
    {
      prompt: "Use the edit tool to add the line 'Oolong too.' at the end of Notes/Tea.md; don't run commands. If you can't, say so in one sentence.",
      answer: { reply: "reject" },
    },
  ],
  question: [
    {
      prompt: "Use your question tool to ask me which tea I prefer, offering Earl Grey and Sencha. Then reply with one sentence about my answer. Don't edit files.",
      answer: { text: "Sencha" },
    },
  ],
  "interrupt-after-send": [{ prompt: "Write a 500-word story about a lighthouse.", interrupt: "after-send" }],
  "interrupt-mid-stream": [{ prompt: "Write a 500-word story about a lighthouse.", interrupt: "after-text" }],
};

const END = new Set(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]);

/** The vault's temp path in recorded events becomes `VAULT`, so fixtures don't depend on where they were made. */
const normalise = (value: unknown, root: string): unknown => JSON.parse(JSON.stringify(value).replaceAll(root, VAULT));

const recordTurn = (api: OpenCodeApi, sessionId: string, root: string, script: TurnScript) =>
  Effect.scoped(
    Effect.gen(function* () {
      const subscription = yield* api.subscribe;
      const steps: Array<FixtureStep> = [];
      const inboxId = yield* api.prompt(sessionId, script.prompt);
      if (script.interrupt === "after-send") {
        const withdrawn = yield* api.cancelPrompt(sessionId, inboxId).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)));
        const interrupted = yield* api.interrupt(sessionId);
        steps.push({ call: "interrupt", withdrawn, interrupted });
        if (withdrawn && !interrupted) return { prompt: script.prompt, steps };
      }
      let interrupted = false;
      while (true) {
        const signal: OpenCodeSignal | undefined = Option.getOrUndefined(
          yield* PubSub.take(subscription).pipe(Effect.timeoutOption("3 minutes")),
        );
        if (signal === undefined) throw new Error("no events for 3 minutes");
        if (signal._tag !== "event" || sessionOf(signal.event) !== sessionId) continue;
        const event = signal.event;
        steps.push({ event: normalise(encode(event), root) });
        if (END.has(event.type)) return { prompt: script.prompt, steps };
        if (script.interrupt === "after-text" && !interrupted && event.type === "session.text.delta") {
          interrupted = yield* api.interrupt(sessionId);
          steps.push({ call: "interrupt", withdrawn: false, interrupted });
        }
        const answer = script.answer;
        if (answer !== undefined && event.type === "permission.asked" && "reply" in answer) {
          yield* answer.reply === "once"
            ? api.replyPermission(sessionId, event.data.id, "once")
            : api.replyPermission(sessionId, event.data.id, "reject", DENIED);
          steps.push({ call: "reply", requestId: event.data.id, reply: answer.reply });
        }
        if (answer !== undefined && event.type === "form.created" && "text" in answer) {
          const values = Object.fromEntries(event.data.form.fields.map((field) => [field.key, answer.text]));
          yield* api.replyForm(sessionId, event.data.form.id, values);
          steps.push({ call: "reply", requestId: event.data.form.id, reply: answer.text });
        }
      }
    }),
  );

const record = (name: string, turns: ReadonlyArray<TurnScript>, model: string | null) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-record-"))),
        (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
      );
      for (const [path, content] of Object.entries(VAULT_FILES)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      const api = yield* startServer({ binary: process.env.WIKI_AGENTS_OPENCODE ?? "opencode" });
      const sessionId = yield* api.createSession({ directory: root, model, permissions: SESSION_PERMISSIONS });
      const recorded = [];
      for (const script of turns) recorded.push(yield* recordTurn(api, sessionId, root, script));
      const fixture: Fixture = {
        scenario: name,
        opencodeVersion: api.version,
        model: model ?? (yield* api.defaultModel(root)),
        sessionId,
        turns: recorded,
      };
      writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
      yield* Effect.log(`recorded ${name}: ${recorded.map((turn) => turn.steps.length).join(" + ")} steps`);
    }),
  );

const { values, positionals } = parseArgs({ options: { model: { type: "string" } }, allowPositionals: true });
const names = positionals.length > 0 ? positionals : Object.keys(SCENARIOS);
const unknown = names.filter((name) => SCENARIOS[name] === undefined);
if (unknown.length > 0) throw new Error(`unknown scenario: ${unknown.join(", ")} (have ${Object.keys(SCENARIOS).join(", ")})`);

await Effect.runPromise(Effect.forEach(names, (name) => record(name, SCENARIOS[name] ?? [], values.model ?? null), { discard: true }));
