<script lang="ts">
  import { tick } from "svelte";
  import { page } from "$app/state";
  import { recent } from "#lib/features/notes/recent.svelte.ts";
  import { quickSwitch } from "#lib/features/search/api.ts";
  import { mentionAt, noteName, withoutMention } from "./mentions.ts";
  import { openThread } from "./open-thread.svelte.ts";

  /** Notes offered at once. */
  const MAX_SUGGESTIONS = 8;

  interface Attached {
    readonly path: string;
    readonly name: string;
  }

  let text = $state("");
  /** Notes attached as context for the next message. */
  let attached = $state<ReadonlyArray<Attached>>([]);
  let includeOpen = $state(false);
  let selection = $state("");
  let textarea: HTMLTextAreaElement | undefined = $state();

  /** The `@name` being typed, once the caret moves into one. */
  let mention = $state<{ readonly start: number; readonly query: string } | null>(null);
  let suggestions = $state<ReadonlyArray<Attached>>([]);
  let active = $state(0);

  const vaultId = $derived(openThread.thread?.vaultId);
  const openPath = $derived(page.url.searchParams.get("note"));
  const running = $derived(openThread.running);
  const selectionLines = $derived(selection === "" ? 0 : selection.split("\n").length);

  // Notes matching the `@name` (recent notes for a bare `@`), without those attached.
  $effect(() => {
    const current = mention;
    const vault = vaultId;
    if (current === null || vault === undefined) {
      suggestions = [];
      return;
    }
    const taken = new Set(attached.map((note) => note.path));
    const offer = (notes: ReadonlyArray<Attached>) => {
      suggestions = notes.filter((note) => !taken.has(note.path)).slice(0, MAX_SUGGESTIONS);
      active = 0;
    };
    if (current.query === "") {
      offer(recent.list(vault).filter((file) => file.kind === "note").map((file) => ({ path: file.path, name: file.title })));
      return;
    }
    const controller = new AbortController();
    quickSwitch(vault, current.query, controller.signal).then(
      (response) => offer(response.results.filter((result) => result.kind === "note").map((result) => ({ path: result.path, name: result.title }))),
      () => {
        if (!controller.signal.aborted) suggestions = [];
      },
    );
    return () => controller.abort();
  });

  const track = () => {
    if (textarea === undefined) return;
    mention = textarea.selectionStart === textarea.selectionEnd ? mentionAt(text, textarea.selectionStart) : null;
  };

  /** Attaches a note and takes its `@name` out of the message. */
  async function pick(note: Attached) {
    if (!attached.some((other) => other.path === note.path)) attached = [...attached, note];
    if (mention !== null && textarea !== undefined) {
      const next = withoutMention(text, mention.start, textarea.selectionStart);
      text = next.text;
      mention = null;
      await tick();
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
    }
  }

  /** "+ add": starts an `@` at the caret, which offers notes. */
  async function startMention() {
    if (textarea === undefined) return;
    const caret = textarea.selectionStart;
    const before = text.slice(0, caret);
    const insert = before === "" || /\s$/.test(before) ? "@" : " @";
    text = before + insert + text.slice(caret);
    await tick();
    textarea.focus();
    textarea.setSelectionRange(caret + insert.length, caret + insert.length);
    track();
  }

  /** Takes the text selected in the open note. */
  const takeSelection = () => {
    const selected = window.getSelection();
    const inNote = selected?.anchorNode?.parentElement?.closest(".prose");
    selection = inNote ? (selected?.toString() ?? "") : "";
  };

  /** Moving the caret can enter or leave an `@name`; Up and Down move through the notes instead. */
  function onkeyup(event: KeyboardEvent) {
    const choosing = mention !== null && suggestions.length > 0;
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || (!choosing && ["ArrowUp", "ArrowDown"].includes(event.key))) track();
  }

  function onkeydown(event: KeyboardEvent) {
    if (mention !== null && suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        active = (active + step + suggestions.length) % suggestions.length;
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        const note = suggestions[active];
        if (note !== undefined) void pick(note);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        mention = null;
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  const submit = async () => {
    const message = text.trim();
    if (message === "" || running) return;
    const notes: Array<{ path: string; selection?: string }> = attached.map((note) => ({ path: note.path }));
    if (openPath !== null && (includeOpen || selection !== "") && !attached.some((note) => note.path === openPath)) {
      notes.push({ path: openPath, ...(selection === "" ? {} : { selection }) });
    }
    if (await openThread.send(message, notes)) {
      text = "";
      attached = [];
      selection = "";
      includeOpen = false;
      mention = null;
    }
  };
</script>

<div class="composer">
  <div class="context" role="group" aria-label="Context for your next message">
    <span class="label">context:</span>
    {#each attached as note (note.path)}
      <span class="chip" title={note.path}>
        @{note.name}
        <button type="button" aria-label="Remove {note.name}" onclick={() => (attached = attached.filter((other) => other.path !== note.path))}>×</button>
      </span>
    {/each}
    {#if openPath !== null && (includeOpen || selection !== "")}
      <span class="chip" title={openPath}>
        @{noteName(openPath)}{selection === "" ? "" : ` · selection · ${selectionLines} ${selectionLines === 1 ? "line" : "lines"}`}
        <button
          type="button"
          aria-label="Remove the open note"
          onclick={() => {
            includeOpen = false;
            selection = "";
          }}>×</button
        >
      </span>
    {/if}
    <button type="button" class="add" onclick={startMention}>+ add</button>
    {#if openPath !== null && !includeOpen && selection === ""}
      <button type="button" class="add" onclick={() => (includeOpen = true)}>+ open note</button>
    {/if}
    {#if openPath !== null}
      <button type="button" class="add" onpointerdown={(event) => event.preventDefault()} onclick={takeSelection}>+ selection</button>
    {/if}
  </div>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    {#if mention !== null && suggestions.length > 0}
      <ul class="suggestions" id="note-suggestions" role="listbox" aria-label="Notes to add">
        {#each suggestions as note, index (note.path)}
          <!-- The message box keeps focus and handles the keyboard; options only need the pointer. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id="note-suggestion-{index}"
            role="option"
            aria-selected={index === active}
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => pick(note)}
            onpointerenter={() => (active = index)}
          >
            <span class="name">{note.name}</span>
            <span class="path">{note.path}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <textarea
      bind:this={textarea}
      bind:value={text}
      rows="2"
      placeholder={running ? "The agent is working…" : "Reply, or type @ to add a note"}
      aria-label="Message"
      aria-autocomplete="list"
      aria-controls={mention !== null && suggestions.length > 0 ? "note-suggestions" : undefined}
      aria-activedescendant={mention !== null && suggestions.length > 0 ? `note-suggestion-${active}` : undefined}
      oninput={track}
      onclick={track}
      {onkeyup}
      onblur={() => (mention = null)}
      {onkeydown}
    ></textarea>
    {#if running}
      <button type="button" class="stop" onclick={() => openThread.stop()}>Stop</button>
    {:else}
      <button type="submit" class="send" disabled={openThread.sending || text.trim() === ""}>Send</button>
    {/if}
  </form>
  <p class="hint">Enter to send · Shift+Enter for a new line · @ adds a note as context</p>
</div>

<style>
  .composer {
    flex: 0 0 auto;
    border-top: 1px solid var(--line-soft);
    background: var(--surface);
  }
  .context {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 12px 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-3);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    padding: 2px 2px 2px 6px;
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--accent-ink);
    overflow-wrap: anywhere;
  }
  .chip button {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .add {
    padding: 2px 4px;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font: inherit;
    cursor: pointer;
  }
  .add:hover {
    color: var(--ink);
  }
  form {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px 12px 4px;
  }
  .suggestions {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: calc(100% - 4px);
    z-index: 3;
    max-height: 280px;
    overflow: auto;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
  }
  [role="option"] {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  [role="option"][aria-selected="true"] {
    background: var(--accent-soft);
  }
  .name {
    font-size: 14px;
    color: var(--ink);
  }
  .path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
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
  .send,
  .stop {
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
  .send:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .stop {
    border-color: var(--del);
    background: transparent;
    color: var(--del);
  }
  .hint {
    margin: 0;
    padding: 0 12px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-3);
  }
  @media (max-width: 899px) {
    textarea {
      font-size: 16px;
    }
    [role="option"] {
      min-height: 44px;
      justify-content: center;
    }
  }
</style>
