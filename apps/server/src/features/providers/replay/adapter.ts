import type { RequestAnswer } from "@wiki-agents/contracts/threads/model";
import { Context, Deferred, Effect, Option, Stream } from "effect";
import type { ProviderAdapter, ProviderError, ProviderEvent, ProviderSession } from "../port.js";
import type { Step } from "./transcript.js";
import { chooseTranscript } from "./transcripts.js";

/** Multiplies every replay delay; 0 plays instantly. */
export const ReplaySpeed = Context.Reference<number>("ReplaySpeed", { defaultValue: () => 1 });

const DELAY = { chunk: 45, tool: 350 } as const;
const WORDS_PER_CHUNK = 3;

const delay = (ms: number) =>
  Effect.flatMap(ReplaySpeed, (speed) => (ms * speed > 0 ? Effect.sleep(ms * speed) : Effect.void));

const chunks = (text: string) => {
  const words = text.match(/\s*\S+\s*/g) ?? [];
  const result: Array<string> = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) result.push(words.slice(i, i + WORDS_PER_CHUNK).join(""));
  return result;
};

type Events = Stream.Stream<ProviderEvent, ProviderError>;
type RequestStep = Extract<Step, { type: "approval" | "question" }>;
type Vars = Readonly<Record<string, string>>;

const emitAfter = (ms: number, event: ProviderEvent): Events => Stream.fromEffect(Effect.as(delay(ms), event));

/** Stops after the turn's last event, so steps after a `fail` never play. */
const untilFinished = (events: Events) => events.pipe(Stream.takeUntil((event) => event._tag === "turn.finished"));

/**
 * Plays transcripts for one thread. Ids come from the turn id and the step's
 * position (`<turn>:2.approve.0`), so a turn resumed after a restart produces the
 * same ids as before it.
 */
const makeSession = Effect.gen(function* () {
  const answers = new Map<string, Deferred.Deferred<RequestAnswer>>();
  const answerFor = Effect.fnUntraced(function* (requestId: string) {
    const existing = answers.get(requestId);
    if (existing !== undefined) return existing;
    const created = yield* Deferred.make<RequestAnswer>();
    answers.set(requestId, created);
    return created;
  });

  /** The steps from `start` on; `prefix` + index is each step's path. */
  const play = (turnId: string, steps: ReadonlyArray<Step>, prefix: string, vars: Vars, start = 0): Events => {
    const step = steps[start];
    if (step === undefined) return Stream.empty;
    const path = `${prefix}${start}`;
    if (step.type === "fail") {
      return emitAfter(DELAY.tool, { _tag: "turn.finished", turnId, outcome: "failed", usage: null, reason: step.reason });
    }
    return Stream.concat(stepEvents(turnId, step, path, vars), Stream.suspend(() => play(turnId, steps, prefix, vars, start + 1)));
  };

  /** Waits for the answer to a request step, then plays the branch for it. */
  const branch = (turnId: string, step: RequestStep, path: string, vars: Vars): Events =>
    Stream.unwrap(
      Effect.gen(function* () {
        const answer = yield* Deferred.await(yield* answerFor(`${turnId}:${path}`));
        if (step.type === "approval") {
          return answer._tag === "approval" && answer.decision === "approve"
            ? play(turnId, step.approve, `${path}.approve.`, vars)
            : play(turnId, step.deny, `${path}.deny.`, vars);
        }
        return play(turnId, step.then, `${path}.then.`, { ...vars, answer: answer._tag === "question" ? answer.text : "" });
      }),
    );

  const stepEvents = (turnId: string, step: Exclude<Step, { type: "fail" }>, path: string, vars: Vars): Events => {
    const id = `${turnId}:${path}`;
    switch (step.type) {
      case "text": {
        const text = step.text.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
        return Stream.fromIterable(chunks(text)).pipe(
          Stream.mapEffect((chunk) =>
            Effect.as(delay(DELAY.chunk), { _tag: "message.delta", turnId, messageId: id, text: chunk } satisfies ProviderEvent),
          ),
        );
      }
      case "tool":
        return Stream.concat(
          emitAfter(DELAY.tool, { _tag: "tool.called", turnId, callId: id, name: step.name, input: step.input }),
          emitAfter(DELAY.tool, { _tag: "tool.finished", turnId, callId: id, status: step.status ?? "succeeded", output: step.output }),
        );
      case "pause":
        return Stream.unwrap(Effect.as(delay(step.ms), Stream.empty));
      case "approval":
      case "question":
        return Stream.concat(
          emitAfter(DELAY.tool, {
            _tag: "request.opened",
            turnId,
            requestId: id,
            prompt:
              step.type === "approval"
                ? { _tag: "approval", title: step.title, detail: step.detail }
                : { _tag: "question", question: step.question, options: step.options },
          }),
          branch(turnId, step, path, vars),
        );
    }
  };

  /**
   * How to continue a turn waiting on `requestId` (its request already sent): wait
   * for the answer, play its branch, then the steps after it at every level.
   */
  const resumeAt = (turnId: string, steps: ReadonlyArray<Step>, prefix: string, requestId: string): Option.Option<Events> => {
    for (const [index, step] of steps.entries()) {
      const path = `${prefix}${index}`;
      const rest = () => play(turnId, steps, prefix, {}, index + 1);
      if ((step.type === "approval" || step.type === "question") && `${turnId}:${path}` === requestId) {
        return Option.some(Stream.concat(branch(turnId, step, path, {}), Stream.suspend(rest)));
      }
      const inner =
        step.type === "approval"
          ? Option.orElse(resumeAt(turnId, step.approve, `${path}.approve.`, requestId), () =>
              resumeAt(turnId, step.deny, `${path}.deny.`, requestId),
            )
          : step.type === "question"
            ? resumeAt(turnId, step.then, `${path}.then.`, requestId)
            : Option.none<Events>();
      if (Option.isSome(inner)) return Option.some(Stream.concat(inner.value, Stream.suspend(rest)));
    }
    return Option.none();
  };

  const session: ProviderSession = {
    startTurn: ({ turnId, text }) => {
      const transcript = chooseTranscript(text);
      return untilFinished(
        Stream.concat(
          play(turnId, transcript.steps, "", {}),
          Stream.succeed<ProviderEvent>({ _tag: "turn.finished", turnId, outcome: "completed", usage: transcript.usage, reason: null }),
        ),
      );
    },
    resumeTurn: ({ turnId, text, pendingRequestIds }) =>
      Effect.sync(() => {
        const transcript = chooseTranscript(text);
        const requestId = pendingRequestIds[0];
        if (requestId === undefined) return Option.none();
        return Option.map(resumeAt(turnId, transcript.steps, "", requestId), (events) =>
          untilFinished(
            Stream.concat(
              events,
              Stream.succeed<ProviderEvent>({ _tag: "turn.finished", turnId, outcome: "completed", usage: transcript.usage, reason: null }),
            ),
          ),
        );
      }),
    interrupt: () => Effect.void,
    answerRequest: (requestId, answer) => Effect.flatMap(answerFor(requestId), (deferred) => Deferred.succeed(deferred, answer)),
  };
  return session;
});

/**
 * Plays recorded turns instead of running an agent. The message picks the
 * recording by keyword (see `transcripts.ts`). A turn waiting on a request when the
 * server stopped resumes from that request; one stopped mid-stream can't resume.
 */
export const ReplayAdapter: ProviderAdapter = {
  kind: "replay",
  capabilities: { interrupt: true, resume: true, approvals: true, questions: true },
  openSession: () => makeSession,
};
