<script lang="ts">
  import type { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
  import { tick } from "svelte";
  import { ApiError, errorMessage, isAbort } from "#lib/api/client.ts";
  import { getNote } from "./api.ts";
  import "./prose.css";

  let { vaultId, path }: { vaultId: string; path: string } = $props();

  type NoteState =
    | { readonly status: "loading" }
    | { readonly status: "loaded"; readonly note: GetNoteResponse }
    | { readonly status: "failed"; readonly notFound: boolean; readonly message: string };

  let noteState = $state<NoteState>({ status: "loading" });
  let article: HTMLElement | undefined = $state();
  let attempt = $state(0);

  /** After a new note renders: go to the linked heading, else to the top of the pane. */
  const placeScroll = async () => {
    await tick();
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id === "" ? null : document.getElementById(id);
    if (target) target.scrollIntoView();
    else article?.closest("main")?.scrollTo({ top: 0 });
  };

  $effect(() => {
    void attempt;
    const controller = new AbortController();
    getNote(vaultId, path, controller.signal).then(
      (note) => {
        noteState = { status: "loaded", note };
        void placeScroll();
      },
      (error) => {
        if (isAbort(error)) return;
        noteState = {
          status: "failed",
          notFound: error instanceof ApiError && error.status === 404,
          message: errorMessage(error, "Could not load the note"),
        };
      },
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
    {/if}
  </p>

  {#if noteState.status === "loaded"}
    {#if showTitle}
      <h1 class="title">{noteState.note.title}</h1>
    {/if}
    <!-- Rendered and sanitised on the server (rehype-sanitize). -->
    <div class="prose">{@html noteState.note.html}</div>
  {:else if noteState.status === "failed"}
    <h1 class="title">{noteState.notFound ? "Note not found" : "Couldn't open this note"}</h1>
    <p class="muted mono">{path}</p>
    {#if !noteState.notFound}
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
  }
</style>
