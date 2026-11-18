import { Effect, Stream } from "effect";
import type { ProviderAdapter, ProviderError, ProviderEvent, SessionSetup, TurnInput } from "../../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../../src/features/providers/replay/adapter.js";

/** The script key for a compaction (Compact conversation), recorded in `inputs` as its text. */
export const COMPACT = "<compact>";

/**
 * A turn's script: what the "agent" does (writes files, say) and the events it
 * reports, given the turn id and its working folder. Runs when the turn starts.
 */
export type Script = (turn: { readonly turnId: string; readonly cwd: string }) => Effect.Effect<ReadonlyArray<ProviderEvent>, ProviderError>;

/**
 * A provider whose turns run scripts chosen by the message's text, so tests can make
 * an agent change files exactly as they need: the whole text, else its first line (the
 * message before the notes and files the app adds). Each turn's input (with the
 * attachment folders its setup let it read, and the paths it may never reach) is kept in `inputs`. A script under `*` runs for any other text. A turn ends after its script's events
 * unless the script ends it (or opened a request, which keeps it waiting). A
 * compaction runs the script under `COMPACT`.
 */
export const makeScriptedProvider = (options: { readonly images?: boolean } = {}) => {
  const scripts = new Map<string, Script>();
  const inputs: Array<Omit<TurnInput, "setup"> & { readonly attachmentFolders: ReadonlyArray<string>; readonly protection: SessionSetup["protection"] }> = [];
  const adapter: ProviderAdapter = {
    kind: "scripted",
    capabilities: { interrupt: true, resume: false, approvals: true, questions: true, models: false, images: options.images === true, compact: true },
    openSession: ({ cwd }) =>
      Effect.succeed({
        nativeSessionId: null,
        startTurn: ({ turnId, text, images, setup }) => {
          inputs.push({ turnId, text, images, attachmentFolders: setup.attachmentFolders, protection: setup.protection });
          const script = scripts.get(text) ?? scripts.get(text.split("\n")[0]!) ?? scripts.get("*");
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
        compact: ({ turnId }) => {
          inputs.push({ turnId, text: COMPACT, images: [], attachmentFolders: [], protection: { paths: [], names: [] } });
          const script = scripts.get(COMPACT);
          if (script === undefined) return Stream.die(new Error("no script for a compaction"));
          return Stream.unwrap(
            Effect.map(script({ turnId, cwd }), (events) =>
              Stream.concat(
                Stream.fromIterable(events),
                events.some((event) => event._tag === "turn.finished")
                  ? Stream.empty
                  : Stream.succeed<ProviderEvent>({ _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null }),
              ),
            ),
          );
        },
        resumeTurn: () => Effect.succeedNone,
        interrupt: () => Effect.void,
        answerRequest: () => Effect.void,
        setModel: () => Effect.void,
      }),
    enforcement: () => ({ autonomy: null, notes: [] }),
    status: Effect.succeed({ _tag: "ready", version: null, account: null }),
    listModels: () => Effect.succeed({ models: [], defaultModel: null }),
  };
  /** Replay first (the default), then the scripted provider (instance id `scripted`). */
  const registry = makeProviderRegistry(Effect.succeed([ReplayAdapter, adapter]));
  return { scripts, inputs, registry };
};
