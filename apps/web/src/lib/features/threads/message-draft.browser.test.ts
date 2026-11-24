import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageDraft } from "./message-draft.svelte.ts";

const api = vi.hoisted(() => ({ getDraft: vi.fn(), saveDraft: vi.fn() }));
vi.mock("./api.ts", () => api);

const later = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getDraft.mockResolvedValue({ draft: { text: "saved elsewhere", version: 4 } });
  api.saveDraft.mockResolvedValue({ draft: { text: "new text", version: 5 } });
});

afterEach(() => vi.useRealTimers());

describe("server-backed message drafts", () => {
  it("saves only the latest edit after typing pauses", async () => {
    vi.useFakeTimers();
    const draft = new MessageDraft("one");
    await draft.load();
    expect(draft.text).toBe("saved elsewhere");
    draft.update("first");
    await vi.advanceTimersByTimeAsync(200);
    draft.update("second");
    expect(draft.text).toBe("second");
    await vi.advanceTimersByTimeAsync(299);
    expect(api.saveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.saveDraft).toHaveBeenCalledExactlyOnceWith("one", {
      text: "second", baseVersion: 4, writerId: expect.any(String), sequence: 2,
    });
  });

  it("waits for the latest text, keeps failures visible and preserves text for retry", async () => {
    const draft = new MessageDraft("one");
    await draft.load();
    const write = later<unknown>();
    api.saveDraft.mockReturnValueOnce(write.promise);
    draft.update("my unfinished thought");
    expect(api.saveDraft).not.toHaveBeenCalled();
    const saved = draft.flush();
    expect(draft.pending).toBe(1);
    write.reject(new Error("Cannot save right now"));
    expect(await saved).toBe(false);
    expect(draft.text).toBe("my unfinished thought");
    expect(draft.error).toBe("Cannot save right now");
    draft.retry();
    expect(await draft.flush()).toBe(true);
    expect(draft.error).toBeNull();
    expect(draft.pending).toBe(0);
  });

  it("ignores an older failure after newer text saves", async () => {
    const draft = new MessageDraft("one");
    await draft.load();
    const old = later<unknown>();
    api.saveDraft.mockReturnValueOnce(old.promise);
    draft.update("old");
    const oldDone = draft.flush();
    draft.update("new");
    await draft.flush();
    old.reject(new Error("Old write failed"));
    await oldDone;
    expect(draft.error).toBeNull();
    expect(draft.text).toBe("new");
  });

  it("never saves an empty draft over a failed load", async () => {
    api.getDraft.mockRejectedValueOnce(new Error("Offline"));
    const draft = new MessageDraft("one");
    await draft.load();
    expect(draft.loaded).toBe(false);
    expect(api.saveDraft).not.toHaveBeenCalled();
    await draft.load();
    expect(draft.text).toBe("saved elsewhere");
  });

  it("does not bring back a sent message when reloading the draft fails", async () => {
    const draft = new MessageDraft("one");
    await draft.load();
    api.getDraft.mockRejectedValueOnce(new Error("Offline"));
    await draft.sent();
    expect(draft.text).toBe("");
    expect(draft.error).toBe("Offline");
    expect(api.saveDraft).not.toHaveBeenCalled();
  });
});
