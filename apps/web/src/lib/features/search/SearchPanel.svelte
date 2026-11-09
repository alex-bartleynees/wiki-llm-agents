<script lang="ts">
  import { page } from "$app/state";
  import { noteHref, viewHref } from "@wiki-agents/contracts/notes/model";
  import { untrack } from "svelte";
  import { vaultEvents } from "#lib/features/indexing/vault-events.svelte.ts";
  import { recent } from "#lib/features/notes/recent.svelte.ts";
  import { folderOf } from "./highlight.ts";
  import Marked from "./Marked.svelte";
  import { search } from "./search.svelte.ts";

  const vaultId = $derived(page.params["vaultId"]);
  const current = $derived(page.url.searchParams.get("note"));
  let input: HTMLInputElement | undefined = $state();

  /** Tags offered as filters when nothing is typed. */
  const TAG_LIMIT = 40;

  $effect(() => {
    if (vaultId !== undefined) search.useVault(vaultId);
  });
  const recentFiles = $derived(vaultId === undefined ? [] : recent.list(vaultId));

  // Search as you type, and again whenever the vault changes on disk.
  $effect(() => {
    void search.vaultId;
    void search.text;
    void search.tags;
    void vaultEvents.revision;
    untrack(() => void search.run());
  });

  $effect(() => {
    void search.vaultId;
    void vaultEvents.revision;
    untrack(() => void search.loadTags());
  });

  $effect(() => {
    if (search.focusRequests > 0) input?.focus();
  });

  const resultCount = $derived(
    search.state.status === "loaded"
      ? `${search.state.results.length}${search.state.truncated ? "+" : ""} ${search.state.results.length === 1 ? "note" : "notes"}`
      : "",
  );
  const offeredTags = $derived((search.tagList ?? []).filter((tag) => !search.tags.includes(tag.tag.toLowerCase())).slice(0, TAG_LIMIT));
</script>

<div class="search">
  {#if vaultId === undefined}
    <p class="muted">Open a vault to search it.</p>
  {:else}
    <form role="search" onsubmit={(event) => event.preventDefault()}>
      <label class="visually-hidden" for="search-input">Search notes</label>
      <input
        id="search-input"
        bind:this={input}
        type="search"
        placeholder="Search notes"
        autocomplete="off"
        spellcheck="false"
        bind:value={search.text}
        onkeydown={(event) => {
          if (event.key === "Escape" && search.text !== "") {
            event.stopPropagation();
            search.text = "";
          }
        }}
      />
    </form>

    {#if search.tags.length > 0}
      <ul class="chips" aria-label="Tag filters">
        {#each search.tags as tag (tag)}
          <li>
            <button type="button" class="chip active" aria-label="Remove tag filter {tag}" onclick={() => search.removeTag(tag)}>
              #{tag} <span aria-hidden="true">×</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="status mono" aria-live="polite">
      {#if search.state.status === "failed"}
        {search.state.message}
      {:else if search.hasQuery}
        {search.busy && search.state.status !== "loaded" ? "Searching…" : resultCount}
      {/if}
    </p>

    {#if search.hasQuery && search.state.status === "loaded"}
      {#if search.state.results.length === 0}
        <p class="muted">No notes match.</p>
      {:else}
        <ul class="results" aria-busy={search.busy}>
          {#each search.state.results as result (result.path)}
            {@const folder = folderOf(result.path)}
            <li>
              <a class="result" href={noteHref(vaultId, result.path)} aria-current={result.path === current ? "page" : undefined}>
                <span class="title">{result.title}</span>
                {#if folder}<span class="folder mono">{folder}</span>{/if}
                {#if result.snippet.length > 0}
                  <span class="snippet"><Marked parts={result.snippet} /></span>
                {/if}
              </a>
              {#if result.tags.length > 0}
                <span class="result-tags">
                  {#each result.tags as tag (tag)}
                    <button type="button" class="chip" title="Only notes tagged #{tag}" onclick={() => search.addTag(tag)}>#{tag}</button>
                  {/each}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
        {#if search.state.truncated}
          <p class="muted">Showing the best {search.state.results.length}. Add words or tags to narrow it down.</p>
        {/if}
      {/if}
    {:else if !search.hasQuery}
      {#if recentFiles.length > 0}
        <h3 class="mono">Recent</h3>
        <ul class="plain">
          {#each recentFiles as file (file.path)}
            {@const href = viewHref(vaultId, file.path)}
            {#if href}
              <li>
                <a class="result" {href}>
                  <span class="title">{file.title}</span>
                  {#if folderOf(file.path)}<span class="folder mono">{folderOf(file.path)}</span>{/if}
                </a>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
      {#if offeredTags.length > 0}
        <h3 class="mono">Tags</h3>
        <ul class="chips">
          {#each offeredTags as tag (tag.tag)}
            <li>
              <button type="button" class="chip" onclick={() => search.addTag(tag.tag)}>
                #{tag.tag} <span class="count">{tag.count}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .search {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: 8px;
  }
  input {
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    color: var(--ink);
  }
  .status {
    min-height: 16px;
    margin: 0;
    padding: 0 2px;
    font-size: 11px;
    color: var(--ink-3);
  }
  .muted {
    margin: 0;
    padding: 0 2px;
    font-size: 13px;
    color: var(--ink-3);
  }
  h3 {
    margin: 10px 0 0;
    padding: 0 2px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .results,
  .plain {
    display: grid;
    gap: 2px;
  }
  .results li {
    padding: 2px 0 6px;
    border-bottom: 1px solid var(--line-soft);
  }
  .result {
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    border-radius: var(--radius);
    color: var(--ink-2);
    text-decoration: none;
  }
  .result:hover,
  .result[aria-current="page"] {
    background: var(--sunken);
  }
  .title {
    color: var(--accent-ink);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .folder {
    font-size: 11px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .snippet {
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }
  .result-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 2px 8px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--accent-soft);
    font: inherit;
    font-size: 12px;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .result-tags .chip {
    padding: 0 6px;
    font-size: 11px;
  }
  .chip:hover {
    border-color: var(--accent);
  }
  .chip.active {
    background: var(--accent);
    color: var(--on-accent);
  }
  .count {
    color: var(--ink-3);
    font-size: 11px;
  }
  @media (max-width: 899px) {
    .search {
      padding: 16px;
    }
    input {
      height: 40px;
      font-size: 16px; /* stops iOS zooming into the field */
    }
    .result {
      min-height: 40px;
    }
    .chip {
      padding: 6px 10px;
    }
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
