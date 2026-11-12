import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "#lib/api/client.ts";

/** The note editor store with real Svelte state and timers under test control; the API is a stand-in. */

const api = vi.hoisted(() => ({ getNoteSource: vi.fn(), saveNote: vi.fn() }));
vi.mock("./api.ts", () => api);

const { IDLE_SAVE_MS, NoteEditor, noteEditor } = await import("./note-editor.svelte.ts");

const source = (content: string, hash: string) => ({ vaultId: "v", path: "Tea.md", content, hash, modifiedAt: 1 });
const saved = (hash: string) => ({ path: "Tea.md", hash, modifiedAt: 2 });

/** A promise and the functions that settle it, so a test decides when the server answers. */
const deferred = <A>() => {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

const loaded = async (content = "# Tea\n", hash = "h0") => {
  api.getNoteSource.mockResolvedValueOnce(source(content, hash));
  const editor = new NoteEditor("v", "Tea.md");
  await editor.load();
  return editor;
};

beforeEach(() => {
  vi.useFakeTimers();
  api.getNoteSource.mockReset();
  api.saveNote.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("note editor", () => {
  it("saves once typing pauses, from the version it loaded", async () => {
    const editor = await loaded();
    expect(editor.saveStatus).toBe("saved");
    api.saveNote.mockResolvedValue(saved("h1"));

    editor.edit("# Tea\n\nG");
    await vi.advanceTimersByTimeAsync(IDLE_SAVE_MS - 1);
    editor.edit("# Tea\n\nGreen.");
    expect(editor.saveStatus).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(IDLE_SAVE_MS - 1);
    expect(api.saveNote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(api.saveNote).toHaveBeenCalledTimes(1);
    expect(api.saveNote).toHaveBeenCalledWith("v", { path: "Tea.md", content: "# Tea\n\nGreen.", baseHash: "h0" });
    expect(editor.saveStatus).toBe("saved");

    // The next save starts from the version just written.
    api.saveNote.mockResolvedValue(saved("h2"));
    editor.edit("# Tea\n\nGreen. Oolong.");
    await editor.flush();
    expect(api.saveNote).toHaveBeenLastCalledWith("v", { path: "Tea.md", content: "# Tea\n\nGreen. Oolong.", baseHash: "h1" });
  });

  it("saves text typed during a save afterwards, never two saves at once", async () => {
    const editor = await loaded();
    const first = deferred<ReturnType<typeof saved>>();
    api.saveNote.mockReturnValueOnce(first.promise).mockResolvedValueOnce(saved("h2"));

    editor.edit("one");
    const flushing = editor.flush();
    expect(editor.saveStatus).toBe("saving");
    editor.edit("one two");
    void editor.flush();
    expect(api.saveNote).toHaveBeenCalledTimes(1);

    first.resolve(saved("h1"));
    await flushing;
    await vi.advanceTimersByTimeAsync(IDLE_SAVE_MS);
    expect(api.saveNote).toHaveBeenCalledTimes(2);
    expect(api.saveNote).toHaveBeenLastCalledWith("v", { path: "Tea.md", content: "one two", baseHash: "h1" });
    expect(editor.saveStatus).toBe("saved");
  });

  it("shows a conflict when the save is refused, and saves the merge over the disk version", async () => {
    const editor = await loaded();
    api.saveNote.mockRejectedValueOnce(new ApiError(409, "changed on disk"));
    api.getNoteSource.mockResolvedValueOnce(source("# Tea\n\nTheirs.\n", "hd"));

    editor.edit("# Tea\n\nMine.\n");
    await editor.flush();
    expect(editor.conflict).toEqual({ disk: { content: "# Tea\n\nTheirs.\n", hash: "hd" } });
    expect(editor.hasUnsavedWork).toBe(true);
    // No more saves until it is settled.
    editor.edit("# Tea\n\nMine, merged.\n");
    await vi.advanceTimersByTimeAsync(IDLE_SAVE_MS * 5);
    expect(api.saveNote).toHaveBeenCalledTimes(1);

    api.saveNote.mockResolvedValueOnce(saved("h2"));
    editor.edit("# Tea\n\nTheirs.\nMine.\n");
    await editor.keepMine();
    expect(api.saveNote).toHaveBeenLastCalledWith("v", { path: "Tea.md", content: "# Tea\n\nTheirs.\nMine.\n", baseHash: "hd" });
    expect(editor.conflict).toBeNull();
    expect(editor.saveStatus).toBe("saved");
  });

  it("takes the disk version, dropping your edits, when asked", async () => {
    const editor = await loaded();
    api.saveNote.mockRejectedValueOnce(new ApiError(409, "changed on disk"));
    api.getNoteSource.mockResolvedValueOnce(source("Theirs", "hd"));
    editor.edit("Mine");
    await editor.flush();
    const replaced = editor.replaced;

    editor.takeDisk();
    expect(editor.content).toBe("Theirs");
    expect(editor.replaced).toBe(replaced + 1);
    expect(editor.conflict).toBeNull();
    expect(editor.hasUnsavedWork).toBe(false);
  });

  it("follows changes on disk while nothing is unsaved, and stops for a conflict when something is", async () => {
    const editor = await loaded();
    api.getNoteSource.mockResolvedValueOnce(source("# Tea\n\nFrom Syncthing.\n", "h1"));
    await editor.diskChanged();
    expect(editor.content).toBe("# Tea\n\nFrom Syncthing.\n");
    expect(editor.saveStatus).toBe("saved");

    // Our own save coming back as a vault event changes nothing.
    api.saveNote.mockResolvedValueOnce(saved("h2"));
    editor.edit("# Tea\n\nMine.\n");
    await editor.flush();
    api.getNoteSource.mockResolvedValueOnce(source("# Tea\n\nMine.\n", "h2"));
    await editor.diskChanged();
    expect(editor.conflict).toBeNull();

    editor.edit("# Tea\n\nMine, more.\n");
    api.getNoteSource.mockResolvedValueOnce(source("# Tea\n\nAn agent's.\n", "h3"));
    await editor.diskChanged();
    expect(editor.content).toBe("# Tea\n\nMine, more.\n");
    expect(editor.conflict).toEqual({ disk: { content: "# Tea\n\nAn agent's.\n", hash: "h3" } });
    await vi.advanceTimersByTimeAsync(IDLE_SAVE_MS * 5);
    expect(api.saveNote).toHaveBeenCalledTimes(1);
  });

  it("re-creates a note deleted on disk only when you keep yours", async () => {
    const editor = await loaded();
    editor.edit("# Tea\n\nMine.\n");
    api.getNoteSource.mockRejectedValueOnce(new ApiError(404, "Note not found"));
    await editor.diskChanged();
    expect(editor.conflict).toEqual({ disk: null });

    api.saveNote.mockResolvedValueOnce(saved("h1"));
    await editor.keepMine();
    expect(api.saveNote).toHaveBeenCalledWith("v", { path: "Tea.md", content: "# Tea\n\nMine.\n", baseHash: null });
  });

  it("says why a save failed, and tries again on retry", async () => {
    const editor = await loaded();
    api.saveNote.mockRejectedValueOnce(new ApiError(0, "Can't reach the server; try again"));
    editor.edit("Mine");
    await editor.flush();
    expect(editor.saveStatus).toBe("failed");
    expect(editor.saveError).toBe("Can't reach the server; try again");
    // A failed save doesn't keep retrying on its own.
    await vi.advanceTimersByTimeAsync(IDLE_SAVE_MS * 5);
    expect(api.saveNote).toHaveBeenCalledTimes(1);

    api.saveNote.mockResolvedValueOnce(saved("h1"));
    await editor.retry();
    expect(editor.saveStatus).toBe("saved");
  });

  it("keeps an editor with unsaved work for when the note is opened again", async () => {
    api.getNoteSource.mockResolvedValue(source("# Tea\n", "h0"));
    const first = noteEditor("v", "Tea.md");
    await first.load();
    expect(noteEditor("v", "Tea.md")).not.toBe(first);

    const editing = noteEditor("v", "Tea.md");
    await editing.load();
    api.saveNote.mockRejectedValueOnce(new ApiError(409, "changed on disk"));
    editing.edit("Mine");
    await editing.flush();
    expect(noteEditor("v", "Tea.md")).toBe(editing);
  });
});
