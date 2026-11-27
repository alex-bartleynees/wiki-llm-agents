import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, layer } from "@effect/vitest";
import { ContinueThreadResponse } from "@wiki-agents/contracts/threads/continue-thread/response";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Effect, Stream } from "effect";
import { computeLead } from "../../src/features/indexing/fts-query.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import type { ProviderAdapter, ProviderEvent } from "../../src/features/providers/port.js";
import { Sqlite } from "../../src/shared/persistence/sqlite.js";
import { makeTestApp, TestApp } from "./infrastructure/test-app.js";
import { decode, getThread, isTag, newThread, newVault, post, sendOk, watch } from "./infrastructure/threads.js";

const burstProvider: ProviderAdapter = {
  kind: "replay",
  capabilities: { interrupt: true, resume: false, approvals: false, questions: false, models: false, images: false, compact: false },
  status: Effect.succeed({ _tag: "ready", version: "test", account: null }),
  enforcement: (autonomy) => ({ autonomy, notes: [] }),
  listModels: () => Effect.succeed({ models: [], defaultModel: null }),
  openSession: () =>
    Effect.succeed({
      nativeSessionId: "burst-session",
      startTurn: ({ turnId }) => {
        const events: Array<ProviderEvent> = [
          ...Array.from({ length: 20 }, (_, i): ProviderEvent => ({ _tag: "message.delta", turnId, messageId: "m1", text: `chunk${i} ` })),
          { _tag: "tool.called", turnId, callId: "c1", name: "read", input: "a.md" },
          { _tag: "tool.finished", turnId, callId: "c1", status: "succeeded", output: "ok" },
          ...Array.from({ length: 15 }, (_, i): ProviderEvent => ({ _tag: "message.delta", turnId, messageId: "m2", text: `tail${i} ` })),
          { _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null },
        ];
        return Stream.fromIterable(events);
      },
      resumeTurn: () => Effect.succeedNone,
      interrupt: () => Effect.void,
      answerRequest: () => Effect.void,
      setModel: () => Effect.void,
      listModels: () => Effect.succeed([]),
    }),
};

const BurstApp = makeTestApp({
  providers: makeProviderRegistry(Effect.succeed([burstProvider])),
});

layer(BurstApp)("message.delta coalescing", (it) => {
  it.effect("coalesces rapid message.delta bursts while preserving text, ordering, and gapless seq", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id);
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "go");
      yield* events.until(isTag("turn.finished"));

      const { thread: summary, events: stored } = yield* getThread(thread.id);
      const deltas = stored.filter((item) => item.event._tag === "message.delta");
      expect(deltas.length).toBeLessThanOrEqual(4);
      expect(stored.map((item) => item.seq)).toEqual(stored.map((_, index) => index + 1));
      expect(summary.lastSeq).toBe(stored.length);

      const m1 = deltas.filter((d) => d.event._tag === "message.delta" && d.event.messageId === "m1").map((d) => (d.event._tag === "message.delta" ? d.event.text : "")).join("");
      const m2 = deltas.filter((d) => d.event._tag === "message.delta" && d.event.messageId === "m2").map((d) => (d.event._tag === "message.delta" ? d.event.text : "")).join("");
      expect(m1).toBe(Array.from({ length: 20 }, (_, i) => `chunk${i} `).join(""));
      expect(m2).toBe(Array.from({ length: 15 }, (_, i) => `tail${i} `).join(""));

      const toolIdx = stored.findIndex((item) => item.event._tag === "tool.called");
      const firstM1Idx = stored.findIndex((item) => item.event._tag === "message.delta" && item.event.messageId === "m1");
      const firstM2Idx = stored.findIndex((item) => item.event._tag === "message.delta" && item.event.messageId === "m2");
      expect(firstM1Idx).toBeLessThan(toolIdx);
      expect(toolIdx).toBeLessThan(firstM2Idx);
    }),
  );
});

layer(TestApp)("materialized thread summary columns", (it) => {
  it.effect("keeps materialized columns synchronized across lifecycle and continuations", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const first = yield* newThread(vault.id);
      const events = yield* watch(first.id);
      yield* sendOk(first.id, "hello");
      yield* events.until(isTag("turn.finished"));

      const continued = yield* post(`/api/threads/${first.id}/continue`, { text: "Carry on" }).pipe(
        Effect.flatMap(decode(ContinueThreadResponse)),
        Effect.map((response) => response.thread),
      );

      const { db } = yield* Sqlite;
      const row = db.get<{
        status: string;
        last_seq: number;
        active_subagents: number;
        running_turn_json: string | null;
        last_turn_json: string | null;
        continued_in_thread_id: string | null;
      }>(
        sql`SELECT status, last_seq, active_subagents, running_turn_json, last_turn_json, continued_in_thread_id FROM threads WHERE id = ${first.id}`,
      );
      expect(row).toMatchObject({
        status: "idle",
        active_subagents: 0,
        running_turn_json: null,
        continued_in_thread_id: continued.id,
      });
      expect(row!.last_seq).toBeGreaterThan(0);
      expect(row!.last_turn_json).toContain('"outcome":"completed"');
    }),
  );
});

describe("migration 0035 backfill", () => {
  it("backfills thread summaries, note_tags, and notes.lead for existing rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "wiki-agents-mig35-"));
    try {
      const file = join(dir, "app.db");
      const raw = new Database(file);
      const db = drizzle(raw);
      migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });

      const now = Date.now();
      raw.prepare("INSERT INTO vaults (id, name, root_path, created_at) VALUES ('v1', 'V', '/tmp/v', ?)").run(now);
      raw.prepare("INSERT INTO threads (id, vault_id, provider_instance_id, created_at, updated_at) VALUES ('t1', 'v1', 'replay', ?, ?)").run(now, now);
      raw.prepare("INSERT INTO threads (id, vault_id, provider_instance_id, continued_from_thread_id, created_at, updated_at) VALUES ('t2', 'v1', 'replay', 't1', ?, ?)").run(now + 1, now + 1);
      raw.prepare("INSERT INTO thread_events (thread_id, seq, type, payload, at) VALUES ('t1', 7, 'turn.started', '{}', ?)").run(now);
      raw.prepare("INSERT INTO turns (id, thread_id, input, status, started_at, ended_at) VALUES ('turn1', 't1', 'hi', 'completed', ?, ?)").run(now, now + 10);
      raw.prepare("INSERT INTO notes_fts (vault_id, path, title, body, tags) VALUES ('v1', 'Doc.md', 'Doc', 'Hello\nworld lead', 'Project/Sub')").run();
      const ftsRow = raw.prepare("SELECT rowid FROM notes_fts WHERE vault_id = 'v1' AND path = 'Doc.md'").get() as { rowid: number };
      raw.prepare("INSERT INTO notes (vault_id, path, title, frontmatter, tags, lead, content_hash, fts_rowid) VALUES ('v1', 'Doc.md', 'Doc', '{}', '[\"Project/Sub\"]', '', 'h1', ?)").run(ftsRow.rowid);
      const longBody = `# Long\n\n\tFirst   paragraph.\r\n\r\n${"word ".repeat(60)}\n`;
      const longFts = raw.prepare("INSERT INTO notes_fts (vault_id, path, title, body, tags) VALUES ('v1', 'Long.md', 'Long', ?, '')").run(longBody);
      raw.prepare("INSERT INTO notes (vault_id, path, title, frontmatter, tags, lead, content_hash, fts_rowid) VALUES ('v1', 'Long.md', 'Long', '{}', '[]', '', 'h2', ?)").run(Number(longFts.lastInsertRowid));

      const backfillSql = fileURLToPath(new URL("../../drizzle/0035_backfill_summaries_and_note_tags.sql", import.meta.url));
      const statements = readFileSync(backfillSql, "utf8").split("--> statement-breakpoint");
      for (const stmt of statements) {
        if (stmt.trim() !== "") raw.exec(stmt);
      }

      expect(raw.prepare("SELECT last_seq, status, continued_in_thread_id, last_turn_json FROM threads WHERE id = 't1'").get()).toEqual({
        last_seq: 7,
        status: "idle",
        continued_in_thread_id: "t2",
        last_turn_json: JSON.stringify({ outcome: "completed", reason: null, endedAt: now + 10 }),
      });
      expect(raw.prepare("SELECT tag, path FROM note_tags WHERE vault_id = 'v1'").all()).toEqual([
        { tag: "project/sub", path: "Doc.md" },
      ]);
      expect(raw.prepare("SELECT lead FROM notes WHERE vault_id = 'v1' AND path = 'Doc.md'").get()).toEqual({
        lead: "Hello world lead",
      });
      expect(raw.prepare("SELECT lead FROM notes WHERE vault_id = 'v1' AND path = 'Long.md'").get()).toEqual({
        lead: computeLead(longBody),
      });
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
