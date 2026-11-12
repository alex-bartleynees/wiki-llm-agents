<script lang="ts">
  import { noteHref } from "@wiki-agents/contracts/notes/model";
  import { goto } from "$app/navigation";
  import { ApiError, errorMessage } from "#lib/api/client.ts";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import { shell } from "#lib/ui/layout/shell.svelte.ts";
  import { getNoteSource, saveNote } from "./api.ts";
  import { EDIT_PARAM } from "./edit-param.ts";
  import { foldersOf, newNotePath, noteFileName, renderTemplate, templatesIn } from "./templates.ts";
  import { tree } from "./tree.svelte.ts";

  let {
    open = $bindable(false),
    vaultId,
    folder: startFolder = "",
  }: {
    open?: boolean;
    vaultId: string;
    /** Where the note goes unless another folder is chosen: the open note's folder. */
    folder?: string;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let title = $state("");
  let folder = $state("");
  let template = $state("");
  let creating = $state(false);
  let error = $state<string | null>(null);
  /** A note already at the path: offered to open instead. */
  let existing = $state<string | null>(null);

  const templateFolder = $derived(vaults.byId(vaultId)?.templateFolder ?? null);
  const paths = $derived(tree.state.status === "loaded" && tree.vaultId === vaultId ? tree.state.paths : []);
  const templates = $derived(templatesIn(paths, templateFolder));
  /** Templates stay in their own folder: it isn't offered as a place for notes. */
  const folders = $derived(
    foldersOf(paths).filter((path) => templateFolder === null || (path !== templateFolder && !path.startsWith(`${templateFolder}/`))),
  );
  const fileName = $derived(noteFileName(title));
  const path = $derived(fileName === undefined ? undefined : newNotePath(folder, fileName));

  $effect(() => {
    if (dialog === undefined) return;
    if (open && !dialog.open) {
      title = "";
      folder = folders.includes(startFolder) ? startFolder : "";
      error = null;
      existing = null;
      if (!templates.some((option) => option.path === template)) template = "";
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  const openNote = async (notePath: string) => {
    open = false;
    shell.drawerOpen = false;
    shell.tab = "wiki";
    await goto(`${noteHref(vaultId, notePath)}&${EDIT_PARAM}`);
  };

  const create = async (event: SubmitEvent) => {
    event.preventDefault();
    if (path === undefined || creating) return;
    creating = true;
    error = null;
    existing = null;
    try {
      const content = template === "" ? "" : renderTemplate((await getNoteSource(vaultId, template)).content, { title: title.trim(), now: new Date() });
      const saved = await saveNote(vaultId, { path, content, baseHash: null });
      await openNote(saved.path);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        existing = path;
        error = `There's already a note at ${path}.`;
      } else {
        error = errorMessage(cause, "Couldn't create the note");
      }
    } finally {
      creating = false;
    }
  };
</script>

<dialog bind:this={dialog} aria-labelledby="new-note-heading" onclose={() => (open = false)} onclick={(event) => event.target === dialog && (open = false)}>
  <form onsubmit={create}>
    <header>
      <h2 id="new-note-heading">New note</h2>
      <button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>×</button>
    </header>
    <div class="fields">
      <label>
        <span>Title</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={title} autocomplete="off" autocapitalize="sentences" autofocus required />
      </label>
      <label>
        <span>Folder</span>
        <select bind:value={folder}>
          {#each folders as option (option)}
            <option value={option}>{option === "" ? "/ (top of the vault)" : option}</option>
          {/each}
        </select>
      </label>
      {#if templates.length > 0}
        <label>
          <span>Template</span>
          <select bind:value={template}>
            <option value="">Blank note</option>
            {#each templates as option (option.path)}
              <option value={option.path}>{option.name}</option>
            {/each}
          </select>
        </label>
      {:else}
        <p class="hint">
          {#if templateFolder === null}
            To start notes from templates, choose a template folder in <a href="/settings" onclick={() => (open = false)}>Settings</a>.
          {:else}
            No templates yet: add notes to <span class="mono">{templateFolder}</span>.
          {/if}
        </p>
      {/if}
      {#if path !== undefined}
        <p class="hint mono" aria-label="Path">{path}</p>
      {:else if title.trim() !== ""}
        <p class="hint">Use letters or numbers in the title.</p>
      {/if}
      {#if error !== null}
        <p class="error" role="alert">
          {error}
          {#if existing !== null}
            {@const target = existing}
            <button type="button" class="link" onclick={() => openNote(target)}>Open it</button>
          {/if}
        </p>
      {/if}
    </div>
    <footer>
      <button type="button" onclick={() => (open = false)}>Cancel</button>
      <button type="submit" class="primary" disabled={path === undefined || creating}>{creating ? "Creating…" : "Create"}</button>
    </footer>
  </form>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    margin: 10vh auto auto;
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
  .fields {
    display: grid;
    gap: 12px;
    padding: 16px;
  }
  label {
    display: grid;
    gap: 4px;
  }
  label span {
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-2);
  }
  input,
  select {
    min-width: 0;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    font: inherit;
    font-size: 14px;
    color: var(--ink);
  }
  .hint,
  .error {
    margin: 0;
    font-size: 12px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--del);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .link {
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
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
      margin-top: 8vh;
    }
    input,
    select {
      height: 42px;
      font-size: 16px;
    }
    footer button {
      height: 40px;
    }
  }
</style>
