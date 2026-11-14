import type { Attachment } from "@wiki-agents/contracts/attachments/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The files attached to the message being written, with real Svelte state in a real
 * browser; only the upload is a stand-in, so tests decide when each one answers.
 */

const api = vi.hoisted(() => ({ uploadAttachment: vi.fn() }));
vi.mock("./api.ts", () => ({ ...api, attachmentHref: (id: string) => `/api/attachments/${id}` }));

const { AttachmentDraft } = await import("./draft.svelte.ts");

/** An upload that answers when the test says; awaiting its promise lets the draft see the answer first. */
const pending = () => {
  let resolve!: (attachment: Attachment) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Attachment>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  api.uploadAttachment.mockReturnValueOnce(promise);
  return { resolve, reject, promise };
};


const png = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
const csv = () => new File(["region,total\nnorth,250\n"], "sales.csv", { type: "text/csv" });

describe("AttachmentDraft", () => {
  beforeEach(() => {
    api.uploadAttachment.mockReset();
  });

  it("uploads each file as it is added, and is ready once they are kept", async () => {
    const image = pending();
    const file = pending();
    const draft = new AttachmentDraft();
    draft.add([png(), csv()], true);

    expect(draft.items.map((item) => [item.name.replace(/\d{14}/, "<time>"), item.status])).toEqual([
      ["Pasted image <time>.png", "uploading"],
      ["sales.csv", "uploading"],
    ]);
    expect(draft.items[0]?.preview).toMatch(/^blob:/);
    expect(draft.items[1]?.preview).toBeNull();
    expect(draft.uploading).toBe(true);

    image.resolve({ id: "i1", name: "Pasted image.png", mime: "image/png", size: 4, kind: "image" });
    file.resolve({ id: "f1", name: "sales.csv", mime: "text/csv", size: 23, kind: "file" });
    await Promise.all([image.promise, file.promise]);

    expect(draft.uploading).toBe(false);
    expect(draft.ready.map((attachment) => attachment.id)).toEqual(["i1", "f1"]);
    expect(draft.hasImages).toBe(true);
  });

  it("marks a failed upload, which keeps the message from being sent until removed", async () => {
    const upload = pending();
    const draft = new AttachmentDraft();
    draft.add([csv()]);
    upload.reject(new Error("The file is too large"));
    await upload.promise.catch(() => {});

    expect(draft.items[0]).toMatchObject({ status: "failed", error: "The file is too large" });
    expect(draft.failed).toBe(true);
    draft.remove(draft.items[0]!.key);
    expect(draft.failed).toBe(false);
    expect(draft.items).toEqual([]);
  });

  it("forgets a file removed while it uploads", async () => {
    const upload = pending();
    const draft = new AttachmentDraft();
    draft.add([csv()]);
    draft.remove(draft.items[0]!.key);
    upload.resolve({ id: "f1", name: "sales.csv", mime: "text/csv", size: 23, kind: "file" });
    await upload.promise;

    expect(draft.items).toEqual([]);
    expect(draft.ready).toEqual([]);
  });

  it("says why files were left out, and clears everything after sending", () => {
    api.uploadAttachment.mockReturnValue(new Promise(() => {}));
    const draft = new AttachmentDraft();
    draft.add(Array.from({ length: 12 }, (_, index) => new File(["x"], `${index}.txt`)));

    expect(draft.items).toHaveLength(10);
    expect(draft.refused).toBe("Not attached: a message takes up to 10 files.");
    draft.clear();
    expect(draft.items).toEqual([]);
    expect(draft.refused).toBeNull();
  });
});
