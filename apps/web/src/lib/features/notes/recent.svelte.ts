import type { FileKind } from "@wiki-agents/contracts/notes/model";

export interface RecentFile {
  readonly path: string;
  readonly kind: FileKind;
  readonly title: string;
}

const MAX = 12;
const storageKey = (vaultId: string) => `wiki-agents:recent:${vaultId}`;

const isRecentFile = (value: unknown): value is RecentFile =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as RecentFile).path === "string" &&
  typeof (value as RecentFile).kind === "string" &&
  typeof (value as RecentFile).title === "string";

const read = (vaultId: string): ReadonlyArray<RecentFile> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(vaultId)) ?? "[]");
    return Array.isArray(value) ? value.filter(isRecentFile).slice(0, MAX) : [];
  } catch {
    return [];
  }
};

/**
 * Files opened recently in each vault, newest first, remembered on this device only.
 *
 * Views read `list(vaultId)`; opening a file calls `add` from an event or a load
 * callback, never from an effect. The lists live in a plain cache filled from
 * storage on first read (reading must not write state), and `#version` is the one
 * piece of state: `list` reads it, so views update when `add` bumps it.
 */
class RecentStore {
  #version = $state(0);
  readonly #lists = new Map<string, ReadonlyArray<RecentFile>>();

  list(vaultId: string): ReadonlyArray<RecentFile> {
    void this.#version;
    return this.#cached(vaultId);
  }

  /** Moves the file to the top of the vault's list. */
  add(vaultId: string, file: RecentFile) {
    this.#store(vaultId, [file, ...this.#cached(vaultId).filter((other) => other.path !== file.path)].slice(0, MAX));
  }

  /** Forgets a file that is gone (deleted from the app). */
  remove(vaultId: string, path: string) {
    this.#store(vaultId, this.#cached(vaultId).filter((other) => other.path !== path));
  }

  #store(vaultId: string, files: ReadonlyArray<RecentFile>) {
    this.#lists.set(vaultId, files);
    this.#version++;
    try {
      localStorage.setItem(storageKey(vaultId), JSON.stringify(files));
    } catch {
      // Private mode or full storage: the list just won't survive a reload.
    }
  }

  #cached(vaultId: string): ReadonlyArray<RecentFile> {
    let files = this.#lists.get(vaultId);
    if (files === undefined) {
      files = read(vaultId);
      this.#lists.set(vaultId, files);
    }
    return files;
  }
}

export const recent = new RecentStore();
