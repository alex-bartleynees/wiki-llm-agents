<script lang="ts">
  import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
  import { errorMessage } from "#lib/api/client.ts";
  import WorktreeBranchCleanup from "#lib/features/projects/WorktreeBranchCleanup.svelte";
  import { worktrees } from "#lib/features/projects/worktrees.svelte.ts";

  /**
   * A thread's own git worktree, under its header: the branch and the path (for
   * lazygit or an editor), and **Remove worktree** while the thread is idle, offered
   * plainly once the thread is marked done. Nothing for a thread without one.
   */
  let { thread, idle }: { thread: ThreadSummary; idle: boolean } = $props();

  // Loaded when another thread opens, and when this one settles (a turn ended, or it
  // was marked done), not on every update while a turn runs.
  const projectId = $derived(thread.projectId);
  const threadId = $derived(thread.id);
  const settled = $derived(idle);
  $effect(() => {
    void threadId;
    if (projectId !== null && settled) void worktrees.load(projectId);
  });

  const worktree = $derived(worktrees.forThread(thread.projectId, thread.id));
  /** Another thread works in it too (a continued thread that kept the folder). */
  const shared = $derived(worktree !== undefined && (worktree.threadId !== thread.id || worktree.sharedWith.length > 0));
  let removing = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);

  // A message from another thread's worktree doesn't carry over.
  $effect(() => {
    void thread.id;
    error = null;
    copied = false;
  });

  async function remove() {
    if (thread.projectId === null) return;
    removing = true;
    error = null;
    try {
      await worktrees.remove(thread.projectId, thread.id);
    } catch (cause) {
      error = errorMessage(cause, "Could not remove the worktree");
    } finally {
      removing = false;
    }
  }

  async function copy(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      copied = true;
    } catch {
      error = "Couldn't copy here; select the path instead.";
    }
  }
</script>

{#if worktree}
  <section class="worktree" aria-label="Worktree" data-state={worktree.removedAt !== null ? "removed" : worktree.exists ? "live" : "missing"}>
    <div class="line">
      <span class="branch mono" title="This thread works on its own branch">⎇ {worktree.branch}</span>
      {#if shared}
        <span class="shared mono" title="Another thread works in this worktree too: you share its files. Removing it removes it for both.">shared</span>
      {/if}
      {#if worktree.removedAt !== null}
        <span class="state mono">worktree removed</span>
        {#key worktree.threadId}<WorktreeBranchCleanup {worktree} />{/key}
      {:else}
        <span class="path mono" title={worktree.directory}>{worktree.directory}</span>
        <button type="button" class="link" onclick={() => copy(worktree.directory)}>{copied ? "Copied" : "Copy path"}</button>
      {/if}
    </div>
    {#if worktree.removedAt === null}
      <div class="line">
        {#if !worktree.exists}
          <span class="note">Its folder is missing (deleted outside the app), so turns here fail.</span>
        {:else if shared}
          <span class="note">Shared with another thread: removing it removes it there too.</span>
        {:else if thread.doneAt !== null}
          <span class="note">This thread is done. Remove its worktree? git refuses while it has uncommitted or untracked files; the branch stays.</span>
        {/if}
        <button
          type="button"
          class="remove"
          class:offered={(thread.doneAt !== null && !shared) || !worktree.exists}
          disabled={!idle || removing}
          title={idle
            ? `git worktree remove (without --force); the branch stays${shared ? ". The other thread in this worktree loses it too" : ""}`
            : "Stop the turn or answer it first"}
          onclick={remove}>{removing ? "Removing…" : "Remove worktree"}</button
        >
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .worktree {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface);
    font-size: 12px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .branch {
    flex: 0 0 auto;
    color: var(--accent-ink);
  }
  .shared {
    flex: 0 0 auto;
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink-2);
    font-size: 11px;
  }
  .path {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-3);
  }
  .state,
  .note {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--ink-3);
  }
  [data-state="missing"] .note {
    color: var(--del);
  }
  .link {
    flex: 0 0 auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-ink);
    font: inherit;
    cursor: pointer;
  }
  .remove {
    flex: 0 0 auto;
    margin-left: auto;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    cursor: pointer;
  }
  .remove.offered {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .remove:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .error {
    margin: 0;
    color: var(--del);
    overflow-wrap: anywhere;
  }
  @media (max-width: 899px) {
    .remove {
      height: 32px;
    }
  }
</style>
