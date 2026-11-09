<script lang="ts">
  import type { GetBacklinksResponse } from "@wiki-agents/contracts/notes/get-backlinks/response";
  import type { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
  import { tick } from "svelte";
  import { ApiError, errorMessage, isAbort } from "#lib/api/client.ts";
  import { vaultEvents } from "#lib/features/indexing/vault-events.svelte.ts";
  import PinButton from "#lib/features/pins/PinButton.svelte";
  import { getBacklinks, getNote } from "./api.ts";
  import Backlinks from "./Backlinks.svelte";
  import Outline from "./Outline.svelte";
  import { recent } from "./recent.svelte.ts";
  import { timeAgo } from "./time.ts";
  import "./prose.css";

  let { vaultId, path }: { vaultId: string; path: string } = $props();

  type NoteState =
    | { readonly status: "loading" }
    | { readonly status: "loaded"; readonly note: GetNoteResponse }
    | { readonly status: "failed"; readonly notFound: boolean; readonly message: string };

  let noteState = $state<NoteState>({ status: "loading" });
  let backlinks = $state<GetBacklinksResponse["backlinks"] | undefined>(undefined);
  let article: HTMLElement | undefined = $state();
  let attempt = $state(0);
  /** The note on screen. A reload of the same note (it changed on disk) keeps the scroll position. */
  let shownKey: string | undefined;

  /** After opening a note: go to the linked heading, else to the top of the pane. */
  const placeScroll = async () => {
    await tick();
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id === "" ? null : document.getElementById(id);
    if (target) target.scrollIntoView();
    else article?.closest("main")?.scrollTo({ top: 0 });
  };

  // Rendered links depend on the whole index; keep content only for same-note refreshes.
  $effect(() => {
    void attempt;
    void vaultEvents.revision;
    const key = `${vaultId}\0${path}`;
    if (key !== shownKey) noteState = { status: "loading" };
    const controller = new AbortController();
    getNote(vaultId, path, controller.signal).then(
      (note) => {
        if (controller.signal.aborted) return;
        noteState = { status: "loaded", note };
        if (key !== shownKey) {
          shownKey = key;
          recent.add(vaultId, { path, kind: "note", title: note.title });
          void placeScroll();
        }
      },
      (error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        shownKey = undefined;
        noteState = {
          status: "failed",
          notFound: error instanceof ApiError && error.status === 404,
          message: errorMessage(error, "Could not load the note"),
        };
      },
    );
    return () => controller.abort();
  });

  // Backlinks: any change in the vault can add or remove one.
  let backlinksKey: string | undefined;
  $effect(() => {
    void vaultEvents.revision;
    const key = `${vaultId}\0${path}`;
    if (key !== backlinksKey) backlinks = undefined;
    backlinksKey = key;
    const controller = new AbortController();
    getBacklinks(vaultId, path, controller.signal).then(
      (response) => (backlinks = response.backlinks),
      () => {},
    );
    return () => controller.abort();
  });

  const folders = $derived(path.split("/").slice(0, -1));
  // Most notes start with their own H1; only show the title when they don't.
  const showTitle = $derived(noteState.status === "loaded" && !noteState.note.html.trimStart().startsWith("<h1"));
</script>

<svelte:head>
  <title>{noteState.status === "loaded" ? noteState.note.title : path.split("/").at(-1)} · wiki-agents</title>
</svelte:head>

<article bind:this={article} aria-busy={noteState.status === "loading"}>
  <p class="meta mono">
    {#each folders as folder, index (index)}
      <span>{folder}</span><span class="sep" aria-hidden="true">/</span>
    {/each}
    {#if noteState.status === "loaded"}
      {#each noteState.note.tags as tag (tag)}
        <span class="tag">#{tag}</span>
      {/each}
      <span class="facts">
        {#if noteState.note.headings.length > 1}
          <Outline headings={noteState.note.headings} />
        {/if}
        <PinButton {vaultId} {path} />
        {#if backlinks !== undefined}
          <a href="#backlinks-heading">{backlinks.length} {backlinks.length === 1 ? "backlink" : "backlinks"}</a>
          <span aria-hidden="true">·</span>
        {/if}
        <time datetime={new Date(noteState.note.modifiedAt).toISOString()} title={new Date(noteState.note.modifiedAt).toLocaleString()}>
          modified {timeAgo(noteState.note.modifiedAt)}
        </time>
      </span>
    {/if}
  </p>

  {#if noteState.status === "loaded"}
    {#if showTitle}
      <h1 class="title">{noteState.note.title}</h1>
    {/if}
    <!-- Rendered and sanitised on the server (rehype-sanitize). -->
    <div class="prose">{@html noteState.note.html}</div>
    <Backlinks {vaultId} {backlinks} />
  {:else if noteState.status === "failed"}
    <h1 class="title">{noteState.notFound ? "Note not found" : "Couldn't open this note"}</h1>
    <p class="muted mono">{path}</p>
    {#if noteState.notFound}
      <p class="muted">It may have been moved or deleted.</p>
    {:else}
      <p class="muted">{noteState.message}</p>
      <button type="button" onclick={() => attempt++}>Retry</button>
    {/if}
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</article>

<style>
  article {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 48px 96px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    min-height: 18px;
    margin: 0 0 18px;
    font-size: 11px;
    color: var(--ink-3);
  }
  .sep {
    color: var(--line);
  }
  .tag {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  .sep + .tag,
  .meta > .tag:first-child {
    margin-left: 6px;
  }
  .facts {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    margin-left: auto;
  }
  .facts a {
    color: inherit;
  }
  .title {
    margin: 0 0 16px;
    font: 600 30px/1.2 var(--font-read);
    color: var(--ink);
  }
  .muted {
    color: var(--ink-3);
  }
  button {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    color: var(--ink-2);
    cursor: pointer;
  }
  @media (max-width: 899px) {
    article {
      padding: 18px 18px 48px;
    }
    .facts {
      margin-left: 0;
    }
  }
</style>
