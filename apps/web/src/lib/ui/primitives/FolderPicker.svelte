<script lang="ts" module>
  /** One folder's contents, as a picker source returns it. */
  export interface FolderListing {
    /** The folder shown; what "Choose this folder" picks. */
    readonly path: string;
    /** How to show `path` (e.g. the vault's name for its root). */
    readonly label: string;
    /** The folder above; null at the top. */
    readonly parent: string | null;
    readonly folders: ReadonlyArray<{ readonly name: string; readonly path: string }>;
  }
</script>

<script lang="ts">
  import { errorMessage } from "#lib/api/client.ts";

  let {
    open = $bindable(false),
    title,
    start = null,
    load,
    onchoose,
    typed = false,
  }: {
    open?: boolean;
    title: string;
    /** Where to start; null for the source's own starting folder. */
    start?: string | null;
    /** Lists a folder; null lists the starting folder. Fails with why it can't. */
    load: (path: string | null) => Promise<FolderListing>;
    onchoose: (path: string) => void;
    /** Offer a box to type a path to go to (folders on the machine). */
    typed?: boolean;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let listing = $state<FolderListing | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let goTo = $state("");
  /** The latest request; earlier answers are ignored. */
  let request = 0;
  /** A path typed while a folder loads stays; the folder doesn't replace it. */
  let edited = false;

  async function show(path: string | null) {
    const id = ++request;
    edited = false;
    loading = true;
    error = null;
    try {
      const next = await load(path);
      if (id !== request) return;
      listing = next;
      if (!edited) goTo = next.path;
    } catch (cause) {
      if (id === request) error = errorMessage(cause, "Could not open this folder");
    } finally {
      if (id === request) loading = false;
    }
  }

  $effect(() => {
    if (dialog === undefined) return;
    if (open && !dialog.open) {
      dialog.showModal();
      listing = null;
      const from = start;
      // A starting folder that has gone opens the default one instead.
      void show(from).then(() => (from !== null && listing === null ? show(null) : undefined));
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  const choose = () => {
    if (listing === null) return;
    onchoose(listing.path);
    open = false;
  };
</script>

<dialog bind:this={dialog} aria-label={title} onclose={() => (open = false)} onclick={(event) => event.target === dialog && (open = false)}>
  <div class="box">
    <header>
      <h2>{title}</h2>
      <button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>×</button>
    </header>

    {#if typed}
      <form class="go" onsubmit={(event) => (event.preventDefault(), void show(goTo))}>
        <input class="mono" bind:value={goTo} oninput={() => (edited = true)} aria-label="Folder path" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <button type="submit">Go</button>
      </form>
    {:else if listing}
      <p class="current mono">{listing.label}</p>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <ul aria-busy={loading}>
      {#if listing?.parent != null}
        <li><button type="button" class="up" onclick={() => listing?.parent != null && show(listing.parent)}>↑ Up</button></li>
      {/if}
      {#each listing?.folders ?? [] as folder (folder.path)}
        <li>
          <button type="button" onclick={() => show(folder.path)}><span aria-hidden="true">▸</span> {folder.name}</button>
        </li>
      {:else}
        {#if listing && !loading}<li class="empty">No folders inside.</li>{/if}
      {/each}
    </ul>

    <footer>
      <button type="button" onclick={() => (open = false)}>Cancel</button>
      <button type="button" class="primary" disabled={listing === null || loading} onclick={choose}>Choose this folder</button>
    </footer>
  </div>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 32px));
    height: min(560px, calc(100dvh - 20vh));
    margin: 10vh auto auto;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.25);
    overflow: hidden;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  .box {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .close {
    width: 32px;
    height: 32px;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 20px;
    cursor: pointer;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .go {
    display: flex;
    gap: 8px;
    padding: 12px 16px 8px;
  }
  .go input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
  }
  .current {
    margin: 0;
    padding: 12px 16px 8px;
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }
  ul {
    flex: 1;
    min-height: 0;
    overflow: auto;
    list-style: none;
    margin: 0;
    padding: 4px 8px;
  }
  ul[aria-busy="true"] {
    opacity: 0.6;
  }
  li button {
    width: 100%;
    padding: 8px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  li button:hover {
    background: var(--sunken);
  }
  li span {
    color: var(--ink-3);
  }
  .up {
    color: var(--ink-2);
  }
  .empty {
    padding: 8px;
    color: var(--ink-3);
    font-size: 13px;
  }
  .error {
    margin: 0;
    padding: 0 16px 8px;
    color: var(--del);
    font-size: 13px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--line-soft);
  }
  footer button,
  .go button {
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  footer .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  footer .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  @media (max-width: 899px) {
    dialog {
      width: 100vw;
      max-width: none;
      height: 100dvh;
      max-height: 100dvh;
      margin: 0;
      border: 0;
      border-radius: 0;
    }
    li button {
      min-height: 44px;
    }
  }
</style>
