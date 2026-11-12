<script lang="ts">
  import { Compartment } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { onDestroy, untrack } from "svelte";
  import { vaultEvents } from "#lib/features/indexing/vault-events.svelte.ts";
  import { uploadImage } from "./api.ts";
  import { conflictView, createEditorState, type EditorOptions, insertImages } from "./codemirror.ts";
  import { imageFiles } from "./images.ts";
  import { noteEditor } from "./note-editor.svelte.ts";
  import { tree } from "./tree.svelte.ts";

  let { vaultId, path }: { vaultId: string; path: string } = $props();

  // The view is keyed by note (NoteView), so the editor is chosen once.
  const editor = untrack(() => noteEditor(vaultId, path));
  if (editor.status !== "ready") void editor.load();

  let host: HTMLDivElement | undefined = $state();
  let view = $state.raw<EditorView | undefined>(undefined);
  const merge = new Compartment();
  let imageError = $state<string | null>(null);
  let picker: HTMLInputElement | undefined = $state();
  const options: EditorOptions = {
    vaultId: untrack(() => vaultId),
    vaultPaths: () => (tree.state.status === "loaded" ? tree.state.paths : []),
    onChange: (text) => editor.edit(text),
    onSave: () => void editor.flush(),
    merge,
    uploadImage: async (image, name) => {
      imageError = null;
      return (await uploadImage(untrack(() => vaultId), name, image)).path;
    },
    onImageError: (message) => (imageError = message),
  };

  /** Images chosen with the Image button go where the cursor is. */
  const addChosen = (files: FileList | null) => {
    const current = view;
    const images = imageFiles(files);
    if (picker) picker.value = "";
    if (current === undefined || images.length === 0) return;
    void insertImages(current, images, current.state.selection.main.head, options);
    current.focus();
  };

  $effect(() => {
    if (host === undefined || editor.status !== "ready") return;
    const created = new EditorView({ parent: host, state: createEditorState(untrack(() => editor.content), options) });
    view = created;
    if (untrack(() => editor.conflict) === null) created.focus();
    return () => {
      created.destroy();
      view = undefined;
    };
  });

  // Loaded again, or the disk version taken: start over from the new text.
  $effect(() => {
    void editor.replaced;
    const current = view;
    if (current === undefined) return;
    const text = untrack(() => editor.content);
    if (current.state.sliceDoc() !== text) current.setState(createEditorState(text, options));
  });

  // A conflict shows the disk version inline: red is on disk, green is yours.
  $effect(() => {
    const current = view;
    const conflict = editor.conflict;
    if (current === undefined) return;
    current.dispatch({
      effects: merge.reconfigure(
        conflict === null ? [] : conflictView(conflict.disk?.content ?? ""),
      ),
    });
  });

  // The note changed on disk (or the stream reconnected): follow it, or flag a conflict.
  let seenVersion: string | undefined;
  $effect(() => {
    const version = vaultEvents.versionOf(path);
    if (seenVersion === undefined || seenVersion === version) {
      seenVersion = version;
      return;
    }
    seenVersion = version;
    void untrack(() => editor.diskChanged());
  });

  onDestroy(() => editor.close());

  const statusText = $derived(
    editor.saveStatus === "saving" ? "Saving…" : editor.saveStatus === "unsaved" ? "Unsaved" : editor.saveStatus === "failed" ? "Not saved" : "Saved",
  );
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (!editor.hasUnsavedWork) return;
    void editor.flush();
    event.preventDefault();
  }}
/>
<svelte:document onvisibilitychange={() => document.hidden && void editor.flush()} />

<section class="editor" aria-label="Edit note">
  {#if editor.status === "failed"}
    <p class="muted">{editor.loadError}</p>
    <button type="button" onclick={() => editor.load()}>Retry</button>
  {:else}
    <div class="top">
      <div class="bar">
        <span class="status mono" class:failed={editor.saveStatus === "failed"} role="status" aria-live="polite">{statusText}</span>
        {#if editor.saveError !== null}
          <span class="error">{editor.saveError}</span>
          <button type="button" onclick={() => editor.retry()}>Retry</button>
        {/if}
        {#if imageError !== null}
          <span class="error" role="alert">{imageError}</span>
          <button type="button" onclick={() => (imageError = null)}>Dismiss</button>
        {/if}
        <button type="button" class="image" title="Add an image to assets/ and link it here (or paste or drop one)" disabled={view === undefined} onclick={() => picker?.click()}>Image</button>
        <input bind:this={picker} type="file" accept="image/*" multiple hidden onchange={(event) => addChosen(event.currentTarget.files)} />
      </div>
      {#if editor.conflict !== null}
        <div class="conflict" role="alert">
          {#if editor.conflict.disk === null}
            <p><strong>This note was deleted on disk</strong> while you were editing it. Save to create it again with your text.</p>
          {:else}
            <p>
              <strong>This note changed on disk</strong> while you were editing it. Red is on disk, green is yours:
              choose <em>Keep mine</em> or <em>Use disk</em> for each change, then save.
            </p>
          {/if}
          <div class="actions">
            <button type="button" class="primary" onclick={() => editor.keepMine()}>{editor.conflict.disk === null ? "Save again" : "Save this version"}</button>
            {#if editor.conflict.disk !== null}
              <button type="button" onclick={() => editor.takeDisk()}>Use the disk version</button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    {#if editor.status === "loading"}
      <p class="muted">Loading…</p>
    {/if}
    <div class="host" bind:this={host}></div>
  {/if}
</section>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  /* The save status and a conflict stay in sight while the note scrolls under them. */
  .top {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0;
    background: var(--surface);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-height: 24px;
    font-size: 12px;
  }
  .status {
    color: var(--ink-3);
  }
  .status.failed,
  .error {
    color: var(--del);
  }
  .conflict {
    padding: 10px 12px;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    background: var(--agent-soft);
    color: var(--ink);
    font-size: 14px;
  }
  .conflict p {
    margin: 0 0 8px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .host {
    min-height: 60vh;
  }
  /* 15px on desktop; 16px on phones, or iOS zooms in on focus. */
  .host :global(.cm-editor) {
    font-size: 15px;
  }
  .muted {
    color: var(--ink-3);
  }
  button {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    font-size: 13px;
    color: var(--ink-2);
    cursor: pointer;
  }
  button.image {
    margin-left: auto;
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
  @media (max-width: 899px) {
    .host :global(.cm-editor) {
      font-size: 16px;
    }
    button {
      height: 40px;
    }
  }
</style>
