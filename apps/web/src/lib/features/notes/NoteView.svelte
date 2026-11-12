<script lang="ts">
  import type { GetBacklinksResponse } from "@wiki-agents/contracts/notes/get-backlinks/response";
  import type { GetNoteResponse } from "@wiki-agents/contracts/notes/get-note/response";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { tick } from "svelte";
  import { EDIT_PARAM } from "./edit-param.ts";
  import { ApiError, errorMessage, isAbort } from "#lib/api/client.ts";
  import { vaultEvents } from "#lib/features/indexing/vault-events.svelte.ts";
  import PinButton from "#lib/features/pins/PinButton.svelte";
  import { getBacklinks, getNote } from "./api.ts";
  import Backlinks from "./Backlinks.svelte";
  import DeleteNoteDialog from "./DeleteNoteDialog.svelte";
  import NoteThreads from "./NoteThreads.svelte";
  import Related from "./Related.svelte";
  import { threads } from "#lib/features/threads/threads.svelte.ts";
  import { openThread } from "#lib/features/threads/open-thread.svelte.ts";
  import { shell } from "#lib/ui/layout/shell.svelte.ts";
  import Outline from "./Outline.svelte";
  import { recent } from "./recent.svelte.ts";
  import { timeAgo } from "./time.ts";
  import { agents } from "#lib/features/agents/agents.svelte.ts";
  import { providers } from "#lib/features/threads/providers.svelte.ts";
  import "./prose.css";
  import { mermaidDiagrams } from "./mermaid-diagrams.ts";

  let { vaultId, path, editing = false }: { vaultId: string; path: string; editing?: boolean } = $props();

  /** The note in the other mode: `?note=…&edit` edits it, without `edit` it is read. */
  const modeHref = (edit: boolean) => {
    const url = new URL(page.url.href);
    if (edit) url.searchParams.set(EDIT_PARAM, "");
    else url.searchParams.delete(EDIT_PARAM);
    url.hash = "";
    return `${url.pathname}${url.search.replace(/([?&]edit)=(?=&|$)/, "$1")}`;
  };
  const switchMode = (edit: boolean) => goto(modeHref(edit), { replace: true, reset: false });

  type NoteState =
    | { readonly status: "loading" }
    | { readonly status: "loaded"; readonly note: GetNoteResponse }
    | { readonly status: "failed"; readonly notFound: boolean; readonly message: string };

  let noteState = $state<NoteState>({ status: "loading" });
  let backlinks = $state<GetBacklinksResponse["backlinks"] | undefined>(undefined);
  let article: HTMLElement | undefined = $state();
  let attempt = $state(0);
  let deleting = $state(false);
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

  /** The agent's name, else the provider's, for "Edited by …". */
  const actorName = (actor: string) => agents.get(actor)?.name ?? providers.get(actor)?.name ?? actor;
  const showThread = (threadId: string) => {
    void threads.select(threadId);
    shell.sidePane = "threads";
    shell.tab = "chat";
  };
  // Most notes start with their own H1; only show the title when they don't.
  const showTitle = $derived(noteState.status === "loaded" && !noteState.note.html.trimStart().startsWith("<h1"));
</script>

<svelte:window
  onkeydown={(event) => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "e") return;
    event.preventDefault();
    void switchMode(!editing);
  }}
/>

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
        {#if !editing && noteState.note.headings.length > 1}
          <Outline headings={noteState.note.headings} />
        {/if}
        <PinButton {vaultId} {path} />
        {#if !editing && backlinks !== undefined}
          <a href="#backlinks-heading">{backlinks.length} {backlinks.length === 1 ? "backlink" : "backlinks"}</a>
          <span aria-hidden="true">·</span>
        {/if}
        {#if noteState.note.lastAgentEdit}
          {@const edit = noteState.note.lastAgentEdit}
          <button type="button" class="edited" title={`Open the thread · ${new Date(edit.at).toLocaleString()}`} onclick={() => showThread(edit.threadId)}>
            edited by {actorName(edit.actor)} · {timeAgo(edit.at)}
          </button>
          <span aria-hidden="true">·</span>
        {/if}
        <time datetime={new Date(noteState.note.modifiedAt).toISOString()} title={new Date(noteState.note.modifiedAt).toLocaleString()}>
          modified {timeAgo(noteState.note.modifiedAt)}
        </time>
      </span>
    {/if}
    <span class="modes" role="group" aria-label="Mode">
      <a href={modeHref(false)} aria-current={editing ? undefined : "page"} data-sveltekit-replacestate data-sveltekit-noscroll>Read</a>
      <a href={modeHref(true)} aria-current={editing ? "page" : undefined} data-sveltekit-replacestate data-sveltekit-noscroll title="Edit the markdown (⌘E / Ctrl E)">Edit</a>
    </span>
    {#if noteState.status === "loaded"}
      <button type="button" class="delete" title="Move this note to .trash/ in the vault" onclick={() => (deleting = true)}>Delete</button>
    {/if}
  </p>

  {#if editing}
    <!-- Its own source and saves; keyed so leaving a note saves it and the next one starts fresh. -->
    {#key path}
      <!-- CodeMirror loads only when a note is edited. -->
      {#await import("./NoteEditor.svelte")}
        <p class="muted">Loading the editor…</p>
      {:then { default: NoteEditor }}
        <NoteEditor {vaultId} {path} />
      {:catch}
        <p class="muted">Couldn't load the editor; reload the page.</p>
      {/await}
    {/key}
  {:else if noteState.status === "loaded"}
    {#if showTitle}
      <h1 class="title">{noteState.note.title}</h1>
    {/if}
    <!-- Rendered and sanitised on the server (rehype-sanitize). -->
    {#key noteState.note.html}
      <div class="prose" use:mermaidDiagrams>{@html noteState.note.html}</div>
    {/key}
    <button type="button" onpointerdown={(event) => event.preventDefault()} onclick={async () => {
      const selection = window.getSelection()?.toString() ?? "";
      const created = await threads.create();
      if (created && openThread.thread?.id === created.id && created.vaultId === vaultId) {
        await openThread.send("Help me with this note.", [{ path, ...(selection ? { selection } : {}) }]);
        shell.sidePane = "threads"; shell.tab = "chat";
      }
    }}>Start thread from {path.startsWith("_Inbox/") ? "inbox item" : "note"} or selection</button>
    <Backlinks {vaultId} {backlinks} />
    <Related {vaultId} {path} />
    <NoteThreads {vaultId} {path} />
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

{#if noteState.status === "loaded"}
  <DeleteNoteDialog bind:open={deleting} {vaultId} {path} title={noteState.note.title} backlinks={backlinks?.length} />
{/if}

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
  .modes {
    display: inline-flex;
    margin-left: 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .modes a {
    padding: 3px 10px;
    color: var(--ink-2);
    text-decoration: none;
  }
  .modes a[aria-current="page"] {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  .delete {
    height: auto;
    padding: 3px 8px;
    font-size: 11px;
    color: var(--ink-3);
  }
  .delete:hover {
    border-color: var(--del);
    color: var(--del);
  }
  /* Amber marks what an agent wrote. */
  .edited {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--agent);
    font: inherit;
    cursor: pointer;
  }
  .edited:hover {
    text-decoration: underline;
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
