import { ApiError, errorMessage } from "#lib/api/client.ts";
import { getNoteSource, saveNote } from "./api.ts";

/** How long typing has to pause before the note is saved. */
export const IDLE_SAVE_MS = 1000;

/** A version of the note on disk; `hash` is null for a note that doesn't exist. */
interface Version {
  readonly content: string;
  readonly hash: string | null;
}

/**
 * The note on disk no longer matches the version the edit started from. `disk` is
 * what is there now, null when the note was deleted.
 */
export interface Conflict {
  readonly disk: { readonly content: string; readonly hash: string } | null;
}

export type SaveStatus = "saved" | "unsaved" | "saving" | "failed";

/**
 * Editing one note: what the editor shows, the version on disk it is based on, and
 * saving. Saves happen when typing pauses (`IDLE_SAVE_MS`), on `flush` (blur, ⌘S,
 * leaving the editor), and only ever from the base version (the server checks its
 * hash). When the note changes on disk: with nothing unsaved the editor takes the new
 * version; with unsaved edits it stops saving and shows a `conflict` until you keep
 * yours (`keepMine`, after merging) or take the disk's (`takeDisk`).
 */
export class NoteEditor {
  status = $state<"loading" | "ready" | "failed">("loading");
  loadError = $state<string | null>(null);
  /** The text in the editor. */
  content = $state("");
  /** Bumped when `content` is replaced from outside the editor (loaded, disk version taken): the editor resets. */
  replaced = $state(0);
  saving = $state(false);
  /** Why the last save failed (other than a conflict); cleared by the next save. */
  saveError = $state<string | null>(null);
  conflict = $state<Conflict | null>(null);
  #base = $state<Version>({ content: "", hash: null });
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Set once the note is deleted from the app: nothing more is saved. */
  #discarded = false;
  #inFlight: Promise<void> | undefined;

  constructor(
    readonly vaultId: string,
    readonly path: string,
  ) {}

  /** True while the editor holds text that isn't on disk. */
  get dirty(): boolean {
    return this.status === "ready" && this.content !== this.#base.content;
  }

  /** True while leaving would lose something: unsaved text, a save on its way, or a conflict to settle. */
  get hasUnsavedWork(): boolean {
    return this.dirty || this.saving || this.conflict !== null;
  }

  get saveStatus(): SaveStatus {
    if (this.saving) return "saving";
    if (this.saveError !== null) return "failed";
    return this.dirty ? "unsaved" : "saved";
  }

  async load() {
    this.status = "loading";
    try {
      const source = await getNoteSource(this.vaultId, this.path);
      this.#take({ content: source.content, hash: source.hash });
      this.status = "ready";
    } catch (error) {
      this.loadError = errorMessage(error, "Could not open the note for editing");
      this.status = "failed";
    }
  }

  /** The editor's text changed: save once typing pauses. */
  edit(content: string) {
    this.content = content;
    this.#schedule();
  }

  /** Saves now if there is anything to save (and waits for a save already on its way). */
  async flush() {
    clearTimeout(this.#timer);
    while (this.#inFlight !== undefined) await this.#inFlight;
    if (this.#discarded || !this.dirty || this.conflict !== null) return;
    this.#inFlight = this.#save().finally(() => (this.#inFlight = undefined));
    await this.#inFlight;
  }

  /** Try a failed save again. */
  retry() {
    this.saveError = null;
    return this.flush();
  }

  /**
   * The note may have changed on disk (a vault event). Takes the new version when
   * nothing is unsaved, else shows the conflict; a change that is our own save, or a
   * newer disk version during a conflict, just updates what we compare with.
   */
  async diskChanged() {
    if (this.status !== "ready" || this.#discarded) return;
    while (this.#inFlight !== undefined) await this.#inFlight;
    const disk = await this.#readDisk();
    if (disk === undefined || disk?.hash === this.#base.hash) return;
    if (disk !== null && disk.content === this.content) {
      // The same text arrived from elsewhere: nothing to save or settle.
      this.#base = disk;
      this.conflict = null;
    } else if (this.conflict !== null) {
      this.conflict = { disk };
    } else if (disk !== null && !this.dirty) {
      clearTimeout(this.#timer);
      this.#take(disk);
    } else {
      clearTimeout(this.#timer);
      this.conflict = { disk };
    }
  }

  /** Settles a conflict with what is in the editor now (yours, or a merge): it is saved over the disk version. */
  keepMine() {
    if (this.conflict === null) return Promise.resolve();
    const { disk } = this.conflict;
    this.#base = disk ?? { content: "", hash: null };
    this.conflict = null;
    this.saveError = null;
    return this.flush();
  }

  /** Settles a conflict by dropping your edits for the disk version. */
  takeDisk() {
    const disk = this.conflict?.disk;
    if (disk === null || disk === undefined) return;
    this.conflict = null;
    this.saveError = null;
    this.#take(disk);
  }

  /** The editor closes: save what is left (unless it waits on a conflict). */
  close() {
    void this.flush();
  }

  /** The note was deleted from the app: drop the edits, and never save (which would bring it back). */
  discard() {
    this.#discarded = true;
    clearTimeout(this.#timer);
  }

  #take(version: Version) {
    this.#base = version;
    this.content = version.content;
    this.replaced++;
  }

  #schedule() {
    clearTimeout(this.#timer);
    if (this.#discarded || !this.dirty || this.conflict !== null || this.saveError !== null) return;
    this.#timer = setTimeout(() => void this.flush(), IDLE_SAVE_MS);
  }

  async #save() {
    const content = this.content;
    this.saving = true;
    try {
      const saved = await saveNote(this.vaultId, { path: this.path, content, baseHash: this.#base.hash });
      this.#base = { content, hash: saved.hash };
      this.saveError = null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const disk = await this.#readDisk();
        if (disk !== null && disk?.content === content) this.#base = disk;
        else if (disk !== undefined) this.conflict = { disk };
      } else {
        this.saveError = errorMessage(error, "Couldn't save");
      }
    } finally {
      this.saving = false;
    }
    // Typed while saving: save that too once typing pauses.
    this.#schedule();
  }

  /** The note on disk now; null when it is gone; undefined (and `saveError` set) when it couldn't be read. */
  async #readDisk(): Promise<Conflict["disk"] | undefined> {
    try {
      const source = await getNoteSource(this.vaultId, this.path);
      return { content: source.content, hash: source.hash };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      this.saveError = errorMessage(error, "Couldn't read the note on disk");
      return undefined;
    }
  }
}

/**
 * Editors with unsaved work outlive their view, so going back to a note (or away and
 * back mid-conflict) finds the edit where it was. Clean ones are dropped.
 */
const open = new Map<string, NoteEditor>();

export const noteEditor = (vaultId: string, path: string): NoteEditor => {
  const key = `${vaultId}\0${path}`;
  const existing = open.get(key);
  if (existing !== undefined && existing.status === "ready" && existing.hasUnsavedWork) return existing;
  const editor = new NoteEditor(vaultId, path);
  open.set(key, editor);
  return editor;
};

/** True when any open editor would lose work if the page went away. */
export const anyUnsavedWork = () => [...open.values()].some((editor) => editor.hasUnsavedWork);

/** True when the note is open in an editor holding work that deleting it would lose. */
export const hasUnsavedEdits = (vaultId: string, path: string) => open.get(`${vaultId}\0${path}`)?.hasUnsavedWork ?? false;

/** The note was deleted from the app: its editor (if any) stops saving and is forgotten. */
export const discardEditor = (vaultId: string, path: string) => {
  const key = `${vaultId}\0${path}`;
  open.get(key)?.discard();
  open.delete(key);
};

/** Saves what the note's editor holds (if it is open and can save), so deleting the note keeps it in the trash copy. */
export const flushEditor = async (vaultId: string, path: string) => {
  await open.get(`${vaultId}\0${path}`)?.flush();
};
