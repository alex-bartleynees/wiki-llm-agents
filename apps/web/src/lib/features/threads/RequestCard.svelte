<script lang="ts">
  import type { TimelineItem } from "./timeline.ts";
  import { openThread } from "./open-thread.svelte.ts";
  import DiffView from "#lib/features/changes/DiffView.svelte";

  let { request }: { request: Extract<TimelineItem, { kind: "request" }> } = $props();

  let text = $state("");
  let busy = $state(false);
  const pending = $derived(request.answer === "pending");

  const answer = async (value: Parameters<typeof openThread.answer>[1]) => {
    busy = true;
    await openThread.answer(request.requestId, value);
    busy = false;
  };

  /** A file edit the agent proposes: shown per file with its warnings, and answered with Apply. */
  const edits = $derived(request.prompt._tag === "approval" ? (request.prompt.edits ?? []) : []);

  const outcome = $derived.by(() => {
    const answer = request.answer;
    if (answer === "pending") return "";
    if (answer === null) return "Cancelled: the turn ended";
    if (answer._tag === "approval") return answer.decision === "approve" ? (edits.length > 0 ? "Applied" : "Approved") : "Denied";
    return `Answered: ${answer.text}`;
  });
</script>

<section class="card" class:pending aria-label={request.prompt._tag === "approval" ? "Approval" : "Question"}>
  {#if request.prompt._tag === "approval"}
    <p class="kind mono">{edits.length > 0 ? "Proposed edit" : "Approval needed"}</p>
    <p class="title">{request.prompt.title}</p>
    {#if edits.length > 0}
      {#each edits as edit, index (index)}
        <div class="edit">
          {#if edits.length > 1}<p class="path mono">{edit.path}</p>{/if}
          {#each edit.warnings as warning (warning)}
            <p class="warning" role="note">⚠ {warning}</p>
          {/each}
          <DiffView diff={edit.patch} label={`Proposed change to ${edit.path}`} />
        </div>
      {/each}
    {:else if request.prompt.detail}
      <div class="edit"><DiffView diff={request.prompt.detail} label="Details" /></div>
    {/if}
    {#if pending}
      <div class="actions">
        <button type="button" class="primary" disabled={busy} onclick={() => answer({ _tag: "approval", decision: "approve" })}>{edits.length > 0 ? "Apply" : "Approve"}</button>
        <button type="button" disabled={busy} onclick={() => answer({ _tag: "approval", decision: "deny" })}>Deny</button>
      </div>
    {/if}
  {:else}
    <p class="kind mono">Question</p>
    <p class="title">{request.prompt.question}</p>
    {#if pending}
      <div class="actions wrap">
        {#each request.prompt.options as option (option)}
          <button type="button" disabled={busy} onclick={() => answer({ _tag: "question", text: option })}>{option}</button>
        {/each}
      </div>
      <form
        onsubmit={(event) => {
          event.preventDefault();
          if (text.trim() !== "") void answer({ _tag: "question", text: text.trim() });
        }}
      >
        <input bind:value={text} placeholder="Or type an answer" aria-label="Answer" disabled={busy} />
        <button type="submit" class="primary" disabled={busy || text.trim() === ""}>Answer</button>
      </form>
    {/if}
  {/if}
  {#if !pending}
    <p class="outcome mono">{outcome}</p>
  {/if}
</section>

<style>
  .card {
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .card.pending {
    border-color: var(--agent);
    background: var(--agent-soft);
  }
  p {
    margin: 0;
  }
  .kind {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--agent);
  }
  .title {
    margin-top: 2px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .edit {
    margin-top: 8px;
  }
  .path {
    margin-bottom: 4px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .warning {
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--agent);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .wrap {
    flex-wrap: wrap;
  }
  form {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  input {
    flex: 1 1 auto;
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  button {
    min-height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .outcome {
    margin-top: 6px;
    font-size: 11px;
    color: var(--ink-3);
  }
</style>
