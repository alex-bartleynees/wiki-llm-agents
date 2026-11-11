import { Effect, Stream } from "effect";
import type { ProviderAdapter, ProviderError, ProviderEvent } from "../../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../../src/features/providers/replay/adapter.js";

/**
 * A turn's script: what the "agent" does (writes files, say) and the events it
 * reports, given the turn id and its working folder. Runs when the turn starts.
 */
export type Script = (turn: { readonly turnId: string; readonly cwd: string }) => Effect.Effect<ReadonlyArray<ProviderEvent>, ProviderError>;

/**
 * A provider whose turns run scripts chosen by the message's text, so tests can make
 * an agent change files exactly as they need. A turn ends after its script's events
 * unless the script ends it (or opened a request, which keeps it waiting).
 */
export const makeScriptedProvider = () => {
  const scripts = new Map<string, Script>();
  const adapter: ProviderAdapter = {
    kind: "scripted",
    capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: false },
    openSession: ({ cwd }) =>
      Effect.succeed({
        nativeSessionId: null,
        startTurn: ({ turnId, text }) => {
          const script = scripts.get(text);
          if (script === undefined) return Stream.die(new Error(`no script for "${text}"`));
          return Stream.unwrap(
            Effect.map(script({ turnId, cwd }), (events) => {
              const waits = events.some((event) => event._tag === "request.opened" || event._tag === "turn.finished");
              return Stream.concat(
                Stream.fromIterable(events),
                waits ? Stream.never : Stream.succeed<ProviderEvent>({ _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null }),
              );
            }),
          );
        },
        resumeTurn: () => Effect.succeedNone,
        interrupt: () => Effect.void,
        answerRequest: () => Effect.void,
        setModel: () => Effect.void,
      }),
    enforcement: () => ({ autonomy: null, notes: [] }),
    status: Effect.succeed({ _tag: "ready", version: null }),
    listModels: () => Effect.succeed({ models: [], defaultModel: null }),
  };
  /** Replay first (the default), then the scripted provider (instance id `scripted`). */
  const registry = makeProviderRegistry(Effect.succeed([ReplayAdapter, adapter]));
  return { scripts, registry };
};
