<script lang="ts">
  import { tick, untrack } from "svelte";
  import { page } from "$app/state";
  import { formatSize } from "@wiki-agents/contracts/attachments/model";
  import type { ProviderModel } from "@wiki-agents/contracts/providers/model";
  import { AttachmentDraft } from "#lib/features/attachments/draft.svelte.ts";
  import { modelWithoutImages } from "#lib/features/attachments/draft.ts";
  import { recent } from "#lib/features/notes/recent.svelte.ts";
  import { quickSwitch } from "#lib/features/search/api.ts";
  import { MessageDraft } from "./message-draft.svelte.ts";
  import { listModels } from "./api.ts";
  import { mentionAt, noteName, withoutMention } from "./mentions.ts";
  import { openThread } from "./open-thread.svelte.ts";
  import { running as activeThreads } from "./running.svelte.ts";
  import { providers } from "./providers.svelte.ts";

  /** Notes offered at once. */
  const MAX_SUGGESTIONS = 8;

  interface Attached {
    readonly path: string;
    readonly name: string;
  }

  let { threadId }: { threadId: string } = $props();
  const draft = untrack(() => new MessageDraft(threadId));
  $effect(() => {
    void draft.load();
    return () => void draft.flush();
  });
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
  /** Subagents still at work while the agent itself is idle: you can send, and Stop stops them. */
  const subagentsOnly = $derived(!running && openThread.subagentsWorking > 0);
  const childrenWorking = $derived(activeThreads.threads.some((thread) =>
    thread.parentThreadId === threadId && (thread.status !== "idle" || thread.subagentsActive > 0),
  ));
  const selectionLines = $derived(selection === "" ? 0 : selection.split("\n").length);

  /** Files for the next message, uploaded as they are added. */
  const files = new AttachmentDraft();
  $effect(() => () => files.clear());
  let picker: HTMLInputElement | undefined = $state();
  /** Files are being dragged over the composer. */
  let dropping = $state(false);
  /** Send this message's images as files, for a model that can't see images. */
  let imagesAsFiles = $state(true);

  const provider = $derived(providers.get(openThread.thread?.providerInstanceId));
  /** The thread's model, when it can't see images and the message has some. */
  let blindModel = $state<ProviderModel | null>(null);
  $effect(() => {
    const threadId = openThread.threadId;
    void openThread.thread?.model;
    blindModel = null;
    if (!files.hasImages || threadId === null || !provider?.capabilities.models) return;
    const controller = new AbortController();
    // Unknown when the list fails: taken to see images, as the server does.
    listModels(threadId, controller.signal).then(
      (response) => (blindModel = modelWithoutImages(response.models, response.current)),
      () => {},
    );
    return () => controller.abort();
  });
  /** The provider can't take images at all: the server sends them as files. */
  const providerBlind = $derived(files.hasImages && provider !== undefined && !provider.capabilities.images);

  const hasFiles = (transfer: DataTransfer | null) => transfer?.types.includes("Files") === true;

  /** Pasted files (a screenshot, a copied file) are attached rather than typed. */
  function onpaste(event: ClipboardEvent) {
    const pasted = [...(event.clipboardData?.files ?? [])];
    if (pasted.length === 0) return;
    event.preventDefault();
    files.add(pasted, true);
  }

  function ondragover(event: DragEvent) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dropping = true;
  }

  function ondrop(event: DragEvent) {
    dropping = false;
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    files.add(event.dataTransfer?.files ?? []);
  }

  let submitting = $state(false);
  const canSend = $derived(!submitting && draft.loaded && !openThread.sending && !files.uploading && !files.failed && (draft.text.trim() !== "" || files.ready.length > 0));

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
    mention = textarea.selectionStart === textarea.selectionEnd ? mentionAt(draft.text, textarea.selectionStart) : null;
  };

  /** Attaches a note and takes its `@name` out of the message. */
  async function pick(note: Attached) {
    if (!attached.some((other) => other.path === note.path)) attached = [...attached, note];
    if (mention !== null && textarea !== undefined) {
      const next = withoutMention(draft.text, mention.start, textarea.selectionStart);
      draft.update(next.text);
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
    const before = draft.text.slice(0, caret);
    const insert = before === "" || /\s$/.test(before) ? "@" : " @";
    draft.update(before + insert + draft.text.slice(caret));
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
    const message = draft.text.trim();
    if (!canSend || running) return;
    submitting = true;
    try {
      if (!await draft.flush() || openThread.thread?.id !== threadId) return;
      const notes: Array<{ path: string; selection?: string }> = attached.map((note) => ({ path: note.path }));
      if (openPath !== null && (includeOpen || selection !== "") && !attached.some((note) => note.path === openPath)) {
        notes.push({ path: openPath, ...(selection === "" ? {} : { selection }) });
      }
      const sent = files.ready.map((attachment) => attachment.id);
      const asFiles = blindModel !== null && imagesAsFiles;
      if (await openThread.send(message, notes, sent.length === 0 ? {} : { attachments: sent, ...(asFiles ? { imagesAsFiles: true } : {}) })) {
        // The server cleared the matching draft atomically with accepting the message.
        await draft.load();
        attached = [];
        selection = "";
        includeOpen = false;
        mention = null;
        files.clear();
        imagesAsFiles = true;
      }
    } finally {
      submitting = false;
    }
  };
</script>

<svelte:document onvisibilitychange={() => document.hidden && void draft.flush()} />
<svelte:window onpagehide={() => void draft.flush()} onbeforeunload={(event) => {
  void draft.flush();
  if (draft.error !== null || (draft.pending > 0 && new TextEncoder().encode(JSON.stringify(draft.text)).byteLength >= 59_000)) event.preventDefault();
}} />

<!-- Dropping files anywhere on the composer attaches them; the Attach button does the same from the keyboard. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="composer" class:dropping {ondragover} ondragleave={() => (dropping = false)} {ondrop}>
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
    <button type="button" class="add" title="Attach images or files (or paste or drop them)" onclick={() => picker?.click()}>+ attach</button>
    <!-- No `accept`: any file, and on a phone the photo library and camera too. -->
    <input
      bind:this={picker}
      type="file"
      multiple
      hidden
      aria-label="Files to attach"
      onchange={(event) => {
        files.add(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
      }}
    />
  </div>

  {#if files.items.length > 0}
    <ul class="files" aria-label="Files to send">
      {#each files.items as item (item.key)}
        {@const image = item.preview !== null && item.attachment?.kind !== "file"}
        <li class="file" class:image data-status={item.status} title={item.error ?? `${item.name} · ${formatSize(item.size)}`}>
          {#if image}
            <img src={item.preview} alt={item.name} />
          {:else}
            <span class="file-name mono">{item.name}</span>
            <span class="file-size mono">{formatSize(item.size)}</span>
          {/if}
          {#if item.status === "uploading"}
            <span class="state mono">uploading…</span>
          {:else if item.status === "failed"}
            <span class="state failed mono" role="alert">{item.error}</span>
          {/if}
          <button type="button" class="remove" aria-label="Remove {item.name}" onclick={() => files.remove(item.key)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if files.refused}
    <p class="note error" role="alert">{files.refused}</p>
  {/if}
  {#if blindModel !== null}
    <p class="note">
      {blindModel.name} can't see images.
      <label><input type="checkbox" bind:checked={imagesAsFiles} /> Send them as files</label>
    </p>
  {:else if providerBlind}
    <p class="note">{provider?.name} can't see images; they go as files.</p>
  {/if}

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
      value={draft.text}
      disabled={!draft.loaded || submitting || openThread.sending}
      rows="2"
      placeholder={running ? "The agent is working…" : "Reply, or type @ to add a note"}
      aria-label="Message"
      aria-autocomplete="list"
      aria-controls={mention !== null && suggestions.length > 0 ? "note-suggestions" : undefined}
      aria-activedescendant={mention !== null && suggestions.length > 0 ? `note-suggestion-${active}` : undefined}
      oninput={(event) => { draft.update(event.currentTarget.value); track(); }}
      onclick={track}
      {onkeyup}
      onblur={() => (mention = null)}
      {onkeydown}
      {onpaste}
    ></textarea>
    {#if running}
      <button type="button" class="stop" onclick={() => openThread.stop()}>Stop</button>
    {:else}
      {#if childrenWorking}
        <button type="button" class="stop" onclick={() => openThread.stop()} aria-label="Stop child threads">Stop</button>
      {:else if subagentsOnly}
        <button type="button" class="stop" onclick={() => openThread.stop()} aria-label="Stop the subagents" title="Stop every subagent still working">Stop</button>
      {/if}
      <button type="submit" class="send" disabled={!canSend}>Send</button>
    {/if}
  </form>
  {#if draft.error}
    <p class="note error" role="alert">{draft.error} <button type="button" onclick={() => draft.retry()}>Retry</button></p>
  {/if}
  <p class="hint">Enter to send · Shift+Enter for a new line · @ adds a note · paste or drop files</p>
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
  .composer.dropping {
    outline: 2px dashed var(--accent);
    outline-offset: -4px;
  }
  .files {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    padding: 8px 12px 0;
    list-style: none;
  }
  .file {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    max-width: 100%;
    min-height: 56px;
    padding: 6px 30px 6px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 12px;
  }
  .file.image {
    padding: 0;
    overflow: hidden;
  }
  .file img {
    display: block;
    width: 72px;
    height: 72px;
    object-fit: cover;
  }
  .file[data-status="uploading"] img {
    opacity: 0.5;
  }
  .file[data-status="failed"] {
    border-color: var(--del);
  }
  .file-name {
    max-width: 220px;
    overflow-wrap: anywhere;
    color: var(--ink);
  }
  .file-size,
  .state {
    font-size: 11px;
    color: var(--ink-3);
  }
  .file.image .state {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 1px 4px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
  }
  .state.failed {
    color: var(--del);
  }
  .remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.55);
    color: #fff;
    font: inherit;
    line-height: 1;
    cursor: pointer;
  }
  .note {
    margin: 0;
    padding: 6px 12px 0;
    font-size: 12px;
    color: var(--ink-2);
  }
  .note label {
    margin-left: 6px;
    white-space: nowrap;
    cursor: pointer;
  }
  .note.error {
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
    .remove {
      width: 32px;
      height: 32px;
    }
    .file:not(.image) {
      padding-right: 38px;
    }
  }
</style>
