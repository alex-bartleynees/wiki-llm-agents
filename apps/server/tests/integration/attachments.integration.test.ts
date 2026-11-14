import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { expect, layer } from "@effect/vitest";
import type { Attachment } from "@wiki-agents/contracts/attachments/model";
import { UploadAttachmentResponse } from "@wiki-agents/contracts/attachments/upload-attachment/response";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { AttachmentStore } from "../../src/features/attachments/attachment-store.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { decode, getThread, isTag, newThread, newVault, post, sendOk, sendWith, upload, watch } from "./infrastructure/threads.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const CSV = new TextEncoder().encode("TimeGenerated,Message\n2026-11-14T09:00:00Z,started\n");

const uploadOk = (name: string, bytes: Uint8Array) =>
  upload(name, bytes).pipe(
    Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(201))),
    Effect.flatMap(decode(UploadAttachmentResponse)),
  );
/** Sends a message with attachments to a new scripted thread and waits for its turn to end. */
const runTurn = (text: string, attachments: ReadonlyArray<Attachment>) =>
  Effect.gen(function* () {
    const vault = yield* newVault;
    const thread = yield* newThread(vault.id, "scripted");
    const events = yield* watch(thread.id);
    expect((yield* sendWith(thread.id, text, attachments.map((attachment) => attachment.id))).status).toBe(202);
    yield* events.until(isTag("turn.finished"));
    return thread;
  });

const files = makeScriptedProvider();
files.scripts.set("*", () => Effect.succeed([]));

layer(makeTestApp({ providers: files.registry }))("attachments", (it) => {
  it.effect("keeps uploads by content and name: images by their bytes, other files by extension", () =>
    Effect.gen(function* () {
      const image = yield* uploadOk("Pasted image 20261114101500.png", PNG);
      expect(image).toMatchObject({ name: "Pasted image 20261114101500.png", mime: "image/png", size: PNG.length, kind: "image" });
      const csv = yield* uploadOk("C:\\exports\\query_data.csv", CSV);
      expect(csv).toMatchObject({ name: "query_data.csv", mime: "text/csv", size: CSV.length, kind: "file" });

      expect((yield* uploadOk("query_data.csv", CSV)).id).toBe(csv.id);
      expect((yield* uploadOk("other.csv", CSV)).id).not.toBe(csv.id);
      expect(yield* uploadOk("not-an-image.png", CSV)).toMatchObject({ mime: "application/octet-stream", kind: "file" });

      const [stored] = yield* (yield* AttachmentStore).find([csv.id]);
      expect(readFileSync(stored!.path, "utf8")).toBe(new TextDecoder().decode(CSV));
    }),
  );

  it.effect("refuses empty files, missing names and files over 100 MB", () =>
    Effect.gen(function* () {
      expect((yield* upload("empty.csv", new Uint8Array())).status).toBe(400);
      expect((yield* upload("...", CSV)).status).toBe(400);
      expect((yield* HttpClient.post("/api/attachments")).status).toBe(400);
      expect((yield* upload("huge.bin", new Uint8Array(100 * 1024 * 1024 + 1))).status).toBe(413);
    }),
  );

  it.effect("serves images inline and other files as sandboxed downloads", () =>
    Effect.gen(function* () {
      const image = yield* uploadOk("shot.png", PNG);
      const shown = yield* HttpClient.get(`/api/attachments/${image.id}`);
      expect(shown.status).toBe(200);
      expect(shown.headers["content-type"]).toBe("image/png");
      expect(shown.headers["content-disposition"]).toBe("inline");
      expect(shown.headers["content-security-policy"]).toMatch(/^sandbox;/);

      const csv = yield* uploadOk("query data.csv", CSV);
      const downloaded = yield* HttpClient.get(`/api/attachments/${csv.id}`);
      expect(downloaded.headers["content-type"]).toBe("application/octet-stream");
      expect(downloaded.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''query%20data.csv");
      expect(new TextDecoder().decode(new Uint8Array(yield* downloaded.arrayBuffer))).toBe(new TextDecoder().decode(CSV));

      expect((yield* HttpClient.get("/api/attachments/nope")).status).toBe(404);
    }),
  );

  it.effect("sends attached files by path in the message, keeps them in history, and titles an attachment-only thread", () =>
    Effect.gen(function* () {
      const csv = yield* uploadOk("query_data.csv", CSV);
      const image = yield* uploadOk("shot.png", PNG);
      const thread = yield* runTurn("", [csv, image]);

      const input = files.inputs.at(-1)!;
      const [stored] = yield* (yield* AttachmentStore).find([csv.id]);
      expect(existsSync(stored!.path)).toBe(true);
      expect(input.text).toContain(`- ${JSON.stringify(stored!.path)} (text/csv, `);
      // This provider takes no images, so the image goes as a file too.
      expect(input.text).toContain("shot.png");
      expect(input.images).toEqual([]);

      const { thread: summary, events } = yield* getThread(thread.id);
      expect(summary.title).toBe("query_data.csv");
      expect(events.find((stored) => stored.event._tag === "user.message")?.event).toMatchObject({ text: "", attachments: [csv, image] });
    }),
  );

  it.effect("lets a thread read the files sent in it, in later turns too, but not another thread's", () =>
    Effect.gen(function* () {
      const csv = yield* uploadOk("query_data.csv", CSV);
      const thread = yield* runTurn("Analyse this", [csv]);
      const [stored] = yield* (yield* AttachmentStore).find([csv.id]);
      const folder = realpathSync(dirname(stored!.path));
      expect(files.inputs.at(-1)!.attachmentFolders).toEqual([folder]);

      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "And the busiest hour?");
      yield* events.until(isTag("turn.finished"));
      expect(files.inputs.at(-1)!.attachmentFolders).toEqual([folder]);

      yield* runTurn("Something else", []);
      expect(files.inputs.at(-1)!.attachmentFolders).toEqual([]);
    }),
  );

  it.effect("tells the agent what the replay provider received, for tests", () =>
    Effect.gen(function* () {
      const csv = yield* uploadOk("query_data.csv", CSV);
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id, "replay");
      const events = yield* watch(thread.id);
      expect((yield* sendWith(thread.id, "Here it is", [csv.id])).status).toBe(202);
      const seen = yield* events.until(isTag("turn.finished"));
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "notice", text: `Replay received: file query_data.csv (text/csv, ${CSV.length} B).` }));
    }),
  );

  it.effect("refuses a message with neither text nor attachments, or an unknown attachment", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id, "scripted");
      expect((yield* sendWith(thread.id, "  ", [])).status).toBe(400);
      expect((yield* post(`/api/threads/${thread.id}/messages`, { text: "" })).status).toBe(400);
      expect((yield* sendWith(thread.id, "Look at this", ["nope"])).status).toBe(400);
      expect((yield* sendWith(thread.id, "Too many", Array.from({ length: 11 }, (_, index) => `${index}`))).status).toBe(400);
      expect((yield* getThread(thread.id)).events).toEqual([]);
    }),
  );
});

const images = makeScriptedProvider({ images: true });
images.scripts.set("What's in this screenshot?", () => Effect.succeed([]));

layer(makeTestApp({ providers: images.registry }))("attachments to a provider that takes images", (it) => {
  it.effect("sends images as images and other files by path", () =>
    Effect.gen(function* () {
      const image = yield* uploadOk("shot.png", PNG);
      const csv = yield* uploadOk("query_data.csv", CSV);
      yield* runTurn("What's in this screenshot?", [image, csv]);

      const input = images.inputs.at(-1)!;
      const [storedImage, storedCsv] = yield* (yield* AttachmentStore).find([image.id, csv.id]);
      expect(input.images).toEqual([{ path: storedImage!.path, name: "shot.png", mime: "image/png", size: PNG.length }]);
      expect(input.text.startsWith("What's in this screenshot?\n")).toBe(true);
      expect(input.text).toContain(JSON.stringify(storedCsv!.path));
      expect(input.text).not.toContain("shot.png");
    }),
  );

  it.effect("sends images as files when asked, for a model that can't see them, and remembers that", () =>
    Effect.gen(function* () {
      const image = yield* uploadOk("shot.png", PNG);
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id, "scripted");
      const events = yield* watch(thread.id);
      const sent = yield* post(`/api/threads/${thread.id}/messages`, { text: "What's in this screenshot?", attachments: [image.id], imagesAsFiles: true });
      expect(sent.status).toBe(202);
      yield* events.until(isTag("turn.finished"));

      const input = images.inputs.at(-1)!;
      const [stored] = yield* (yield* AttachmentStore).find([image.id]);
      expect(input.images).toEqual([]);
      expect(input.text).toContain(`- ${JSON.stringify(stored!.path)} (image/png, `);
      const { events: history } = yield* getThread(thread.id);
      expect(history.find((event) => event.event._tag === "user.message")?.event).toMatchObject({ imagesAsFiles: true, attachments: [image] });
    }),
  );
});
