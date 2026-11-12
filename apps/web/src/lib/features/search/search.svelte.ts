import type { TagCount } from "@wiki-agents/contracts/search/list-tags/response";
import type { SearchResult } from "@wiki-agents/contracts/search/search-notes/response";
import { errorMessage, isAbort } from "#lib/api/client.ts";
import { shell } from "#lib/ui/layout/shell.svelte.ts";
import { listTags, searchNotes } from "./api.ts";

type SearchState =
  | { readonly status: "idle" }
  | { readonly status: "loaded"; readonly results: ReadonlyArray<SearchResult>; readonly truncated: boolean }
  | { readonly status: "failed"; readonly message: string };

/**
 * Full-text search in the open vault. One store, so the query survives switching
 * between the sidebar and the tree (desktop) or between tabs (phone).
 */
class SearchStore {
  vaultId = $state<string | undefined>(undefined);
  text = $state("");
  /** Lower-case tag filters; a note needs all of them. */
  tags = $state<ReadonlyArray<string>>([]);
  state = $state<SearchState>({ status: "idle" });
  /** True while a search is running; the previous results stay on screen. */
  busy = $state(false);
  tagList = $state<ReadonlyArray<TagCount> | undefined>(undefined);
  /** Bumped to ask the search box to take focus. */
  focusRequests = $state(0);
  #controller: AbortController | undefined;
  #tagsController: AbortController | undefined;

  get hasQuery(): boolean {
    return this.text.trim() !== "" || this.tags.length > 0;
  }

  /** Starts over when the vault changes. */
  useVault(vaultId: string) {
    if (vaultId === this.vaultId) return;
    this.#controller?.abort();
    this.#tagsController?.abort();
    this.vaultId = vaultId;
    this.text = "";
    this.tags = [];
    this.state = { status: "idle" };
    this.tagList = undefined;
  }

  /** Opens the search screen with the box focused, optionally with text to search for. */
  open(text?: string) {
    if (text !== undefined) this.text = text;
    shell.showSearch();
    this.focusRequests++;
  }

  addTag(tag: string) {
    const lower = tag.toLowerCase();
    if (!this.tags.includes(lower)) this.tags = [...this.tags, lower];
  }

  /** Shows the notes with this tag (or one nested under it) on the search screen, and nothing else. */
  showTag(tag: string) {
    this.text = "";
    this.tags = [tag.toLowerCase()];
    shell.showSearch();
  }

  removeTag(tag: string) {
    this.tags = this.tags.filter((other) => other !== tag);
  }

  /** Runs the current query, cancelling the one before; results replace the old ones when they arrive. */
  async run() {
    const vaultId = this.vaultId;
    this.#controller?.abort();
    if (vaultId === undefined || !this.hasQuery) {
      this.state = { status: "idle" };
      this.busy = false;
      return;
    }
    const controller = (this.#controller = new AbortController());
    this.busy = true;
    try {
      const { results, truncated } = await searchNotes(vaultId, { text: this.text, tags: this.tags }, controller.signal);
      this.state = { status: "loaded", results, truncated };
    } catch (error) {
      if (isAbort(error)) return;
      this.state = { status: "failed", message: errorMessage(error, "Search failed") };
    }
    this.busy = false;
  }

  async loadTags() {
    const vaultId = this.vaultId;
    if (vaultId === undefined) return;
    this.#tagsController?.abort();
    const controller = (this.#tagsController = new AbortController());
    try {
      this.tagList = (await listTags(vaultId, controller.signal)).tags;
    } catch (error) {
      if (!isAbort(error)) this.tagList = [];
    }
  }
}

export const search = new SearchStore();
