import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { GetChangeResponse } from "@wiki-agents/contracts/changes/get-change/response";
import { UndoChangeResponse } from "@wiki-agents/contracts/changes/undo-change/response";
import type { FileChange } from "@wiki-agents/contracts/changes/model";
import { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import type { Vault } from "@wiki-agents/contracts/vaults/model";
import { createTwoFilesPatch } from "diff";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { Indexer } from "../../src/features/indexing/indexer.js";
import type { ProviderEvent } from "../../src/features/providers/port.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { makeScriptedProvider, type Script } from "./infrastructure/scripted-provider.js";
import { answer, decode, getThread, isTag, newThread, newVaultWith, post, requestIdOf, sendOk, watch } from "./infrastructure/threads.js";

const provider = makeScriptedProvider();

/** The turn's changes from its `turn.changes` event; empty when it has none. */
const changesOf = (events: ReadonlyArray<ThreadEvent>): ReadonlyArray<FileChange> =>
  events.flatMap((event) => (event._tag === "turn.changes" ? event.changes : []));

const byPath = (changes: ReadonlyArray<FileChange>, path: string) => {
  const found = changes.find((change) => change.path === path);
  if (found === undefined) throw new Error(`no change to ${path}`);
  return found;
};

const undo = (changeId: string) => post(`/api/changes/${changeId}/undo`, {});
const getChange = (changeId: string) => HttpClient.get(`/api/changes/${changeId}`).pipe(Effect.flatMap(decode(GetChangeResponse)));
const getNote = (vaultId: string, path: string) =>
  HttpClient.get(`/api/vaults/${vaultId}/note?path=${encodeURIComponent(path)}`).pipe(Effect.flatMap(decode(GetNoteResponse)));

/** A tool call that writes `paths` (absolute), as a provider reports it. */
const wrote = (turnId: string, callId: string, paths: ReadonlyArray<string>): ReadonlyArray<ProviderEvent> => [
  { _tag: "tool.called", turnId, callId, name: "edit", input: "", writes: paths },
  { _tag: "tool.finished", turnId, callId, status: "succeeded", output: "", writes: paths },
];

/** Runs `script` as a turn of a new scripted thread in `vault` and returns its events. */
const runTurn = (vault: Vault, name: string, script: Script) =>
  Effect.gen(function* () {
    provider.scripts.set(name, script);
    const thread = yield* newThread(vault.id, "scripted");
    const events = yield* watch(thread.id);
    yield* sendOk(thread.id, name);
    return { thread, events: yield* events.until(isTag("turn.finished")) };
  });

layer(makeTestApp({ providers: provider.registry }))("change review", (it) => {
  it.effect("records the replay agent's approved edit, says who edited the note, and undoes it", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Replay note.md": "# Replay\n" });
      const thread = yield* newThread(vault.id);
      const events = yield* watch(thread.id);
      const turnId = yield* sendOk(thread.id, "Please edit the note");
      const opened = yield* events.until(isTag("request.opened"));
      const request = opened.find((event) => event._tag === "request.opened");
      expect(request?._tag === "request.opened" && request.prompt._tag === "approval" ? request.prompt.edits : undefined).toEqual([
        { path: "Replay note.md", patch: expect.stringContaining("+- A line added by the replay agent."), warnings: [] },
      ]);
      yield* answer(thread.id, requestIdOf(opened), { _tag: "approval", decision: "approve" });
      const finished = yield* events.until(isTag("turn.finished"));

      const change = byPath(changesOf(finished), "Replay note.md");
      expect(change).toMatchObject({ change: "modify", attribution: "agent", additions: 1, deletions: 0, truncated: false, warnings: [] });
      expect(change.diff).toBe("@@ -1,1 +1,2 @@\n # Replay\n+- A line added by the replay agent.");
      expect(finished.findIndex(isTag("turn.changes"))).toBe(finished.length - 2);
      expect((yield* getNote(vault.id, "Replay note.md")).lastAgentEdit).toMatchObject({ actor: "replay", threadId: thread.id });

      const undone = yield* undo(change.id).pipe(Effect.flatMap(decode(UndoChangeResponse)));
      expect(undone.changeId).toBe(change.id);
      expect(readFileSync(join(vault.rootPath, "Replay note.md"), "utf8")).toBe("# Replay\n");
      expect((yield* getNote(vault.id, "Replay note.md")).lastAgentEdit).toBeNull();
      expect((yield* getChange(change.id)).undoneAt).toBe(undone.undoneAt);
      const { events: stored } = yield* getThread(thread.id);
      expect(stored.at(-1)?.event).toEqual({ _tag: "change.undone", turnId, changeId: change.id });
      expect((yield* undo(change.id)).status).toBe(409);
    }),
  );

  it.effect("refuses to undo a change when the file has changed since, and shows all three versions", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Tea.md": "# Tea\n\nGreen.\n" });
      const file = join(vault.rootPath, "Tea.md");
      const { events } = yield* runTurn(vault, "edit tea", ({ turnId }) =>
        Effect.sync(() => {
          writeFileSync(file, "# Tea\n\nGreen.\nOolong.\n");
          return wrote(turnId, "c1", [file]);
        }),
      );
      const change = byPath(changesOf(events), "Tea.md");
      writeFileSync(file, "# Tea\n\nGreen.\nOolong.\nSencha.\n");
      yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: ["Tea.md"] });

      const refused = yield* undo(change.id);
      expect(refused.status).toBe(409);
      expect(readFileSync(file, "utf8")).toBe("# Tea\n\nGreen.\nOolong.\nSencha.\n");
      expect(yield* getChange(change.id)).toMatchObject({
        path: "Tea.md",
        change: "modify",
        before: "# Tea\n\nGreen.\n",
        after: "# Tea\n\nGreen.\nOolong.\n",
        current: "# Tea\n\nGreen.\nOolong.\nSencha.\n",
        undoable: false,
        undoneAt: null,
      });
    }),
  );

  it.effect("records created and deleted notes, and undo deletes and restores them", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "Old.md": "# Old\n\nKeep me.\n" });
      const created = join(vault.rootPath, "Notes", "New.md");
      const deleted = join(vault.rootPath, "Old.md");
      const { events } = yield* runTurn(vault, "create and delete", ({ turnId }) =>
        Effect.sync(() => {
          rmSync(deleted);
          mkdirSync(join(vault.rootPath, "Notes"));
          writeFileSync(created, "# New\n");
          return wrote(turnId, "c1", [created, deleted]);
        }),
      );
      const changes = changesOf(events);
      expect(changes.map((change) => [change.path, change.change, change.attribution])).toEqual([
        ["Notes/New.md", "create", "agent"],
        ["Old.md", "delete", "agent"],
      ]);
      expect(byPath(changes, "Old.md").diff).toContain("-Keep me.");

      yield* undo(byPath(changes, "Notes/New.md").id).pipe(Effect.flatMap(decode(UndoChangeResponse)));
      expect(existsSync(created)).toBe(false);
      // The note is gone from the index, but its old version was kept for undo.
      yield* undo(byPath(changes, "Old.md").id).pipe(Effect.flatMap(decode(UndoChangeResponse)));
      expect(readFileSync(deleted, "utf8")).toBe("# Old\n\nKeep me.\n");
      expect((yield* getNote(vault.id, "Old.md")).title).toBe("Old");
    }),
  );

  it.effect("marks a change the provider didn't report as uncertain, like a Syncthing edit during the turn", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "A.md": "# A\n", "B.md": "# B\n", "C.md": "# C\n" });
      const indexer = yield* Indexer;
      const path = (name: string) => join(vault.rootPath, name);
      const { events } = yield* runTurn(vault, "edit with a sync alongside", ({ turnId }) =>
        Effect.gen(function* () {
          writeFileSync(path("A.md"), "# A\n\nBy the agent.\n");
          writeFileSync(path("B.md"), "# B\n\nFrom another machine.\n");
          // C changes and is indexed before the provider reports writing it.
          writeFileSync(path("C.md"), "# C\n\nReported late.\n");
          yield* indexer.run({ _tag: "Sync", vault, paths: ["C.md"] }).pipe(Effect.orDie);
          return [...wrote(turnId, "c1", [path("A.md")]), ...wrote(turnId, "c2", [path("C.md")])];
        }),
      );
      expect(changesOf(events).map((change) => [change.path, change.attribution])).toEqual([
        ["A.md", "agent"],
        ["B.md", "uncertain"],
        ["C.md", "agent"],
      ]);
      expect((yield* getNote(vault.id, "B.md")).lastAgentEdit).toBeNull();
    }),
  );

  it.effect("records nothing for a note changed and changed back during the turn", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "A.md": "# A\n" });
      const indexer = yield* Indexer;
      const file = join(vault.rootPath, "A.md");
      const { events } = yield* runTurn(vault, "change and revert", ({ turnId }) =>
        Effect.gen(function* () {
          writeFileSync(file, "# A\n\nFor a moment.\n");
          yield* indexer.run({ _tag: "Sync", vault, paths: ["A.md"] }).pipe(Effect.orDie);
          writeFileSync(file, "# A\n");
          return wrote(turnId, "c1", [file]);
        }),
      );
      expect(events.some(isTag("turn.changes"))).toBe(false);
    }),
  );

  it.effect("ignores writes outside the vault and changes made while no turn runs", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith({ "A.md": "# A\n" });
      writeFileSync(join(vault.rootPath, "A.md"), "# A\n\nBefore the turn.\n");
      yield* (yield* Indexer).run({ _tag: "Sync", vault, paths: ["A.md"] });
      const outside = join(vault.rootPath, "..", "outside", "x.md");
      const { events } = yield* runTurn(vault, "write outside", ({ turnId }) =>
        Effect.sync(() => {
          writeFileSync(outside, "# X\n");
          return wrote(turnId, "c1", [outside]);
        }),
      );
      expect(events.some(isTag("turn.changes"))).toBe(false);
    }),
  );

  it.effect("puts edit warnings on a proposed edit that cuts the note down and drops its tags", () =>
    Effect.gen(function* () {
      const before = "---\ntags: [tea]\n---\n# Tea\n\nGreen tea in the afternoon, and oolong on cold days.\n";
      const vault = yield* newVaultWith({ "Tea.md": before });
      const patch = createTwoFilesPatch("Tea.md", "Tea.md", before, "# Drinks\n\nTea.\n");
      const { events } = yield* runTurn(vault, "propose a cut", ({ turnId }) =>
        Effect.succeed([
          {
            _tag: "request.opened",
            turnId,
            requestId: `${turnId}:edit`,
            prompt: { _tag: "approval", title: "Edit Tea.md", detail: patch, edits: [{ path: "Tea.md", patch, warnings: [] }] },
          },
          { _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null },
        ]),
      );
      const opened = events.find(isTag("request.opened"));
      const warnings = opened?._tag === "request.opened" && opened.prompt._tag === "approval" ? opened.prompt.edits?.[0]?.warnings : undefined;
      expect(warnings).toEqual([
        expect.stringMatching(/much shorter/),
        'The first heading changed from "Tea" to "Drinks".',
        "Frontmatter dropped: tags.",
        "Tags dropped: tea.",
      ]);
    }),
  );
});
