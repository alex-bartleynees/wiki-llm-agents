<script lang="ts">
  import { goto } from "$app/navigation";
  import { ApiError, errorMessage } from "#lib/api/client.ts";
  import { deleteNote, getNoteSource } from "./api.ts";
  import { discardEditor, flushEditor, hasUnsavedEdits } from "./note-editor.svelte.ts";
  import { recent } from "./recent.svelte.ts";

  let {
    open = $bindable(false),
    vaultId,
    path,
    title,
    backlinks,
  }: {
    open?: boolean;
    vaultId: string;
    path: string;
    title: string;
    /** Notes linking here, when known: their links stop working. */
    backlinks: number | undefined;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  /** The version shown when the dialog opened; deleting is refused if the note changes after. */
  let hash = $state<string | null>(null);
  let unsaved = $state(false);
  let deleting = $state(false);
  let error = $state<string | null>(null);

  /** Saves what the editor holds first (it goes to the trash with the note), then reads the version to delete. */
  const check = async (keepError = false) => {
    hash = null;
    if (!keepError) error = null;
    try {
      await flushEditor(vaultId, path);
      // Only edits waiting on a conflict are still unsaved now.
      unsaved = hasUnsavedEdits(vaultId, path);
      hash = (await getNoteSource(vaultId, path)).hash;
    } catch (cause) {
      error = errorMessage(cause, "Couldn't read the note");
    }
  };

  $effect(() => {
    if (dialog === undefined) return;
    if (open && !dialog.open) {
      void check();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  const remove = async () => {
    if (hash === null || deleting) return;
    deleting = true;
    error = null;
    try {
      await deleteNote(vaultId, path, hash);
      // Before leaving the editor, whose closing would otherwise save the edits.
      discardEditor(vaultId, path);
      recent.remove(vaultId, path);
      open = false;
      await goto(`/vaults/${encodeURIComponent(vaultId)}`, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        error = "The note changed since this opened. Look at it again, then delete.";
        void check(true);
      } else {
        error = errorMessage(cause, "Couldn't delete the note");
      }
    } finally {
      deleting = false;
    }
  };
</script>

<dialog bind:this={dialog} aria-labelledby="delete-note-heading" onclose={() => (open = false)} onclick={(event) => event.target === dialog && (open = false)}>
  <header>
    <h2 id="delete-note-heading">Delete “{title}”?</h2>
    <button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>×</button>
  </header>
  <div class="body">
    <p>It moves to <span class="mono">.trash/</span> in the vault, where you (or Obsidian) can get it back.</p>
    {#if backlinks !== undefined && backlinks > 0}
      <p class="warn">{backlinks} {backlinks === 1 ? "note links" : "notes link"} to it; those links will stop working.</p>
    {/if}
    {#if unsaved}
      <p class="warn">Your edits waiting on a conflict will be lost.</p>
    {/if}
    {#if error !== null}
      <p class="error" role="alert">{error}</p>
    {/if}
  </div>
  <footer>
    <button type="button" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="danger" disabled={hash === null || deleting} onclick={remove}>{deleting ? "Deleting…" : "Delete"}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(440px, calc(100vw - 32px));
    margin: 14vh auto auto;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.25);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .close {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 20px;
    cursor: pointer;
  }
  .body {
    display: grid;
    gap: 8px;
    padding: 16px;
    font-size: 14px;
  }
  p {
    margin: 0;
  }
  .warn {
    color: var(--agent);
  }
  .error {
    color: var(--del);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--line-soft);
  }
  footer button {
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
  footer .danger {
    border-color: var(--del);
    background: var(--del);
    color: var(--on-accent);
    font-weight: 600;
  }
  footer .danger:disabled {
    opacity: 0.6;
    cursor: default;
  }
  @media (max-width: 899px) {
    footer button {
      height: 40px;
    }
  }
</style>
