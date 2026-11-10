<script lang="ts">
  import { quickSwitch } from "#lib/features/search/api.ts";
  import { page } from "$app/state";
  import { openThread } from "./open-thread.svelte.ts";

  let text = $state("");
  let reference = $state("");
  let includeOpen = $state(false);
  let selection = $state("");
  const path = $derived(page.url.searchParams.get("note"));
  let suggestions = $state<ReadonlyArray<string>>([]);
  $effect(() => {
    const vaultId = openThread.thread?.vaultId;
    const query = reference.split(";").at(-1)?.trim().replace(/^@/, "") ?? "";
    const controller = new AbortController();
    if (vaultId && query) void quickSwitch(vaultId, query, controller.signal).then((response) => {
      if (!controller.signal.aborted) suggestions = response.results.filter((note) => note.kind === "note").slice(0, 8).map((note) => note.path);
    }, () => { if (!controller.signal.aborted) suggestions = []; });
    else suggestions = [];
    return () => controller.abort();
  });
  const running = $derived(openThread.running);

  const submit = async () => {
    const message = text.trim();
    if (message === "" || running) return;
    const notes = [...new Set(reference.split(";").map((path) => path.trim().replace(/^@/, "")).filter(Boolean))].map((path) => ({ path }));
    if (path && (includeOpen || selection)) notes.push({ path, ...(selection ? { selection } : {}) });
    if (await openThread.send(message, notes)) { text = ""; reference = ""; selection = ""; includeOpen = false; }
  };
</script>

<div class="context-controls">
  <label>Notes (optional) <input aria-label="Note references" aria-describedby="note-references-help" bind:value={reference} placeholder="@Folder/Note.md; @Other.md" /></label>
  <p id="note-references-help" class="context-help">Attach notes as context for your next message. Type @ and a note name; separate notes with semicolons.</p>
  {#if suggestions.length}<div class="suggestions" aria-label="Matching notes">{#each suggestions as suggestion}<button type="button" onclick={() => { reference = [...reference.split(";").slice(0, -1), `@${suggestion}`, ""].join("; "); }}>{suggestion}</button>{/each}</div>{/if}
  {#if path}
    <label><input type="checkbox" bind:checked={includeOpen} /> Include open note</label>
    <button type="button" onpointerdown={(event) => event.preventDefault()} onclick={() => { const selected = window.getSelection(); const note = selected?.anchorNode?.parentElement?.closest(".prose"); selection = note ? selected?.toString() ?? "" : ""; }}>Include selection</button>
    {#if selection}<span>{selection.length} selected characters <button type="button" onclick={() => selection = ""}>Remove</button></span>{/if}
  {/if}
</div>
<form
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <textarea
    bind:value={text}
    rows="2"
    placeholder={running ? "The agent is working…" : "Message the agent (Enter to send, Shift+Enter for a new line)"}
    aria-label="Message"
    onkeydown={(event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void submit();
      }
    }}
  ></textarea>
  {#if running}
    <button type="button" class="stop" onclick={() => openThread.stop()}>Stop</button>
  {:else}
    <button type="submit" class="send" disabled={openThread.sending || text.trim() === ""}>Send</button>
  {/if}
</form>

<style>
  .context-help { flex: 1 0 100%; min-width: 0; margin: 0; color: var(--ink-3); line-height: 1.5; }
  .suggestions { flex: 1 0 100%; display: flex; flex-wrap: wrap; gap: 4px; }
  .suggestions button { height: auto; font-size: 12px; overflow-wrap: anywhere; max-width: 100%; text-align: left; }
  .context-controls { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 12px; font-size: 12px; }
  .context-controls input { max-width: 100%; background: var(--bg); color: var(--ink); border: 1px solid var(--line); }
  form {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid var(--line-soft);
    background: var(--surface);
  }
  textarea {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 40px;
    max-height: 30vh;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    /* 16px stops iOS from zooming into the field. */
    font-size: max(14px, 1em);
    resize: vertical;
  }
  button {
    height: 40px;
    padding: 0 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .stop {
    border-color: var(--del);
    background: transparent;
    color: var(--del);
  }
  @media (max-width: 899px) {
    textarea {
      font-size: 16px;
    }
  }
</style>
