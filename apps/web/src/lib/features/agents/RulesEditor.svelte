<script lang="ts">
  import { beforeNavigate, goto } from "$app/navigation";
  import { agents } from "./agents.svelte.ts";
  import { RulesEditor } from "./rules-editor.svelte.ts";
  import TextDiff from "./TextDiff.svelte";

  /** Edits `rules/<rulesId>.md`, or creates a rules file when it is null. */
  let { rulesId, onclose }: { rulesId: string | null; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const editor = new RulesEditor(rulesId);

  $effect(() => {
    void editor.load();
    void agents.load();
  });

  /** Set once leaving on purpose, so it isn't asked again. */
  let leaving = false;
  beforeNavigate((navigation) => {
    if (editor.dirty && !editor.saving && !leaving && !confirm("Leave without saving your changes to these rules?")) navigation.cancel();
  });

  const close = () => {
    if (editor.dirty && !confirm("Leave without saving your changes to these rules?")) return;
    leaving = true;
    onclose();
  };

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    const wasNew = editor.isNew;
    if ((await editor.save()) && wasNew && editor.savedId !== null) {
      leaving = true;
      await goto(`/agents/rules?rules=${encodeURIComponent(editor.savedId)}`, { replaceState: true });
      leaving = false;
    }
  };

  const remove = async () => {
    if (!confirm(`Delete rules/${editor.savedId}.md? It goes to the config folder's .trash/, and agents stop getting it from their next message.`)) return;
    if (await editor.remove()) {
      leaving = true;
      onclose();
    }
  };

  const path = $derived(agents.rules.find((rules) => rules.id === editor.savedId)?.path);
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (editor.dirty) event.preventDefault();
  }}
/>

<div class="editor-page">
  <header>
    <button type="button" class="back" aria-label="Back" onclick={close}>←</button>
    <h1>{editor.isNew ? "New rules" : `Rules: ${editor.savedId}`}</h1>
  </header>

  {#if editor.status === "loading"}
    <p class="muted">Loading…</p>
  {:else if editor.status === "missing"}
    <p class="error" role="alert">There is no rules file “{rulesId}”.</p>
  {:else if editor.status === "failed"}
    <p class="error" role="alert">{editor.loadError}</p>
  {:else}
    {#if editor.conflict}
      <section class="conflict" aria-label="Changed on disk">
        <h2>The file changed on disk since you opened it</h2>
        {#if editor.conflict.disk === null}
          <p>It has been deleted (on another machine, or by hand). Save to create it again with your version.</p>
        {:else}
          <p>Red is on disk, green is yours:</p>
          <TextDiff before={editor.conflict.disk.content} after={editor.content} label="On disk, then yours" />
        {/if}
        <div class="actions">
          <button type="button" class="primary" disabled={editor.saving} onclick={() => void editor.keepMine()}>
            {editor.conflict.disk === null ? "Save mine again" : "Save mine over it"}
          </button>
          <button type="button" disabled={editor.saving} onclick={() => editor.useDisk()}>
            {editor.conflict.disk === null ? "Discard mine" : "Use the disk version"}
          </button>
        </div>
      </section>
    {/if}

    <form class="rules-form" onsubmit={save} aria-label={editor.isNew ? "New rules" : "Edit rules"} novalidate>
      {#if editor.isNew}
        <label>
          File name
          <span class="file">
            <span class="mono">rules/</span><input
              class="mono"
              value={editor.id}
              oninput={(event) => (editor.id = event.currentTarget.value.toLowerCase())}
              placeholder="style-guide"
              spellcheck="false"
              autocapitalize="off"
              aria-label="File name"
            /><span class="mono">.md</span>
          </span>
        </label>
      {/if}
      <label>
        Rules for every agent
        <textarea class="mono" bind:value={editor.content} rows="24" spellcheck="true" placeholder="# Rules&#10;&#10;- What every agent should always do."></textarea>
      </label>
      {#each editor.problems as problem (problem)}<p class="error" role="alert">{problem}</p>{/each}
      <p class="hint">Every agent in every vault gets these, rules files in name order, then its own instructions. Threads use a saved change from their next message.</p>
      <div class="actions">
        <button type="submit" class="primary" disabled={editor.saving || (!editor.dirty && !editor.isNew) || editor.conflict !== null}>
          {editor.saving ? "Saving…" : editor.isNew ? "Create rules" : "Save"}
        </button>
        <button type="button" onclick={close}>{editor.dirty ? "Cancel" : "Done"}</button>
        {#if !editor.isNew}
          <button type="button" class="danger" disabled={editor.saving} onclick={() => void remove()}>Delete</button>
        {/if}
        <span class="status" role="status">{editor.dirty ? "Unsaved changes" : editor.isNew ? "" : "Saved"}</span>
      </div>
      {#if path}<p class="hint mono path">{path}</p>{/if}
    </form>
  {/if}
</div>

<style>
  .editor-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px 16px 40px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .back {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    padding: 0;
  }
  .rules-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .file {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--ink-3);
  }
  .file input {
    flex: 1 1 auto;
    min-width: 0;
  }
  input,
  textarea {
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  textarea.mono {
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
  }
  .conflict {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
    padding: 12px 14px;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .conflict h2 {
    margin: 0;
    font-size: 14px;
    color: var(--warn);
  }
  .conflict p {
    margin: 0;
    font-size: 13px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  button {
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .danger {
    margin-left: auto;
    color: var(--del);
  }
  .status,
  .hint,
  .muted {
    margin: 0;
    font-size: 12px;
    color: var(--ink-3);
  }
  .path {
    word-break: break-all;
  }
  .error {
    margin: 0;
    color: var(--del);
  }
  @media (max-width: 899px) {
    input,
    textarea {
      font-size: 16px;
    }
  }
</style>
