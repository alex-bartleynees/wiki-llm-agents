<script lang="ts">
  import type { Project } from "@wiki-agents/contracts/projects/model";
  import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
  import { goto } from "$app/navigation";
  import { errorMessage } from "#lib/api/client.ts";
  import { listThreads } from "#lib/features/threads/api.ts";
  import { threads } from "#lib/features/threads/threads.svelte.ts";
  import { displayPath, location } from "./review-message.ts";
  import { review } from "./review.svelte.ts";

  /** The review's draft comments and where to send them: one of the project's open threads, or a new one. */
  let { project, threadsVersion }: { project: Project; threadsVersion: number } = $props();

  const NEW = "new";
  let open = $state<ReadonlyArray<ThreadSummary>>([]);
  let target = $state<string>(NEW);
  let sending = $state(false);
  let error = $state<string | null>(null);

  const comments = $derived(review.comments(project.id));
  const scope = $derived({ vaultId: project.vaultId, projectId: project.id });

  // The project's open threads, again whenever one changes (`threadsVersion`); the
  // most recent is chosen until you pick one.
  let picked = false;
  $effect(() => {
    void threadsVersion;
    const id = project.id;
    void listThreads(project.vaultId, id)
      .then(({ threads: list }) => {
        if (project.id !== id) return;
        open = list.filter((thread) => thread.doneAt === null).sort((a, b) => b.updatedAt - a.updatedAt);
        if (!open.some((thread) => thread.id === target)) target = open[0]?.id ?? NEW;
        else if (!picked) target = open[0]?.id ?? NEW;
      })
      .catch((cause: unknown) => (error = errorMessage(cause, "Could not load the project's threads")));
  });

  const statusOf = (thread: ThreadSummary) => (thread.status === "running" ? " · running" : thread.status === "waiting" ? " · needs you" : "");

  async function send() {
    sending = true;
    error = null;
    try {
      const threadId = target === NEW ? (await threads.startIn(scope)).id : target;
      await review.send(project.id, project.workingDirectories, threadId);
      await threads.show(scope, threadId);
      await goto(`/projects/${project.id}/threads`);
    } catch (cause) {
      error = errorMessage(cause, "Could not send the review");
    } finally {
      sending = false;
    }
  }
</script>

<section class="panel" aria-label="Review">
  <h2 class="mono">review · {comments.length} {comments.length === 1 ? "comment" : "comments"}</h2>
  {#if comments.length === 0}
    <p class="hint">Click (tap) a line to comment on it. Comments stay on this device until you send them to a thread.</p>
  {:else}
    <ul>
      {#each comments as comment (comment.id)}
        <li>
          <span class="where mono">{location(displayPath(project.workingDirectories, comment.directory, comment.path), comment.lines)}</span>
          <span class="text">{comment.text}</span>
          <button type="button" class="link" aria-label="Delete comment on {comment.path}" onclick={() => review.remove(project.id, comment.id)}>Delete</button>
        </li>
      {/each}
    </ul>
    <label>
      <span class="mono label">send to</span>
      <select
        bind:value={target}
        onchange={() => (picked = true)}
        aria-label="Thread to send the review to"
      >
        {#each open as thread (thread.id)}
          <option value={thread.id}>{thread.title ?? "New thread"}{statusOf(thread)}</option>
        {/each}
        <option value={NEW}>New thread</option>
      </select>
    </label>
    <div class="actions">
      <button type="button" class="link" onclick={() => review.clear(project.id)} disabled={sending}>Discard all</button>
      <button type="button" class="primary" onclick={send} disabled={sending}>{sending ? "Sending…" : "Send to thread"}</button>
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  h2,
  .label {
    margin: 0;
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-3);
  }
  .hint {
    margin: 0;
    color: var(--ink-2);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 8px;
    padding: 6px 8px;
    border-left: 3px solid var(--agent);
    background: var(--sunken);
    border-radius: var(--radius);
  }
  .where {
    font-size: 11px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .text {
    grid-column: 1;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  li .link {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: start;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  select {
    height: 36px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .primary {
    height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    margin: 0;
    color: var(--del);
  }
</style>
