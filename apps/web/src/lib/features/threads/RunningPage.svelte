<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { agents } from "#lib/features/agents/agents.svelte.ts";
  import InboxViewSwitch from "#lib/features/inbox/InboxViewSwitch.svelte";
  import { timeAgo } from "#lib/features/notes/time.ts";
  import { projects } from "#lib/features/projects/projects.svelte.ts";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import { markDone } from "./api.ts";
  import { running } from "./running.svelte.ts";
  import { progressLabel } from "./status.ts";
  import { threadHref } from "./thread-link.ts";

  onMount(() => {
    running.start();
    void vaults.load();
    void agents.load();
  });
  onDestroy(() => running.stop());

  let actionError = $state<string | null>(null);

  const done = async (thread: ThreadSummary) => {
    try {
      running.upsert((await markDone(thread.id)).thread);
      actionError = null;
    } catch (error) {
      actionError = errorMessage(error, "Could not mark the thread done");
    }
  };

  /** "Researcher · Notes · Wiki app": who, in which vault and project. */
  const where = (thread: ThreadSummary) =>
    [
      thread.agentId === null ? null : (agents.get(thread.agentId)?.name ?? thread.agentId),
      vaults.byId(thread.vaultId)?.name ?? null,
      thread.projectId === null ? null : (projects.list.find((project) => project.id === thread.projectId)?.name ?? null),
    ]
      .filter((part) => part !== null)
      .join(" · ");

  const STOPPED_LABEL = { failed: "Failed", interrupted: "Stopped", completed: "Done" } as const;

  const empty = $derived(running.waiting.length + running.working.length + running.stopped.length === 0);
</script>

<div class="running-page">
  <header>
    <InboxViewSwitch view="running" />
  </header>

  {#if running.error}<p class="error" role="alert">{running.error}</p>{/if}
  {#if actionError}<p class="error" role="alert">{actionError}</p>{/if}

  {#if running.status === "loading"}
    <p class="muted">Loading…</p>
  {:else if empty}
    <p class="muted">Nothing running. Threads that are working, waiting for you, or stopped show here, from every vault and project.</p>
  {/if}

  {#snippet row(thread: ThreadSummary, detail: string, reason: string | null)}
    <li>
      <a class="title" href={threadHref(thread.vaultId, thread.id)}>{thread.title ?? "New thread"}</a>
      {#if where(thread)}<span class="where mono">{where(thread)}</span>{/if}
      <span class="detail mono">{detail}</span>
      {#if reason}<span class="reason">{reason}</span>{/if}
      {#if thread.status === "idle"}
        <button type="button" onclick={() => done(thread)}>Mark done</button>
      {/if}
    </li>
  {/snippet}

  {#if running.waiting.length > 0}
    <section aria-label="Waiting for you">
      <h2>Waiting for you · {running.waiting.length}</h2>
      <ul>
        {#each running.waiting as thread (thread.id)}
          {@const turn = thread.runningTurn}
          {@render row(
            thread,
            [
              "Needs you",
              ...(turn?.progress ? [progressLabel(turn.progress)] : []),
              ...(turn ? [`started ${timeAgo(turn.startedAt)}`] : []),
            ].join(" · "),
            null,
          )}
        {/each}
      </ul>
    </section>
  {/if}

  {#if running.working.length > 0}
    <section aria-label="Working">
      <h2>Working · {running.working.length}</h2>
      <ul>
        {#each running.working as thread (thread.id)}
          {@const turn = thread.runningTurn}
          {@render row(
            thread,
            [
              "Working",
              ...(turn?.progress ? [progressLabel(turn.progress), ...(turn.progress.current ? [turn.progress.current] : [])] : []),
              ...(turn ? [`started ${timeAgo(turn.startedAt)}`] : []),
            ].join(" · "),
            null,
          )}
        {/each}
      </ul>
    </section>
  {/if}

  {#if running.stopped.length > 0}
    <section aria-label="Failed or stopped">
      <h2>Failed or stopped · {running.stopped.length}</h2>
      <ul>
        {#each running.stopped as thread (thread.id)}
          {@const last = thread.lastTurn}
          {@render row(thread, last ? `${STOPPED_LABEL[last.outcome]} · ${timeAgo(last.endedAt)}` : "", last?.reason ?? null)}
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .running-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 20px 16px 40px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 12px;
    row-gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  li > :not(button) {
    grid-column: 1;
    min-width: 0;
  }
  li > button {
    grid-column: 2;
    grid-row: 1 / span 4;
    align-self: center;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-2);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  li > button:hover {
    color: var(--ink);
  }
  .title {
    color: var(--ink);
    font-weight: 600;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .title:hover {
    text-decoration: underline;
  }
  .where,
  .detail {
    font-size: 11px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  section[aria-label="Waiting for you"] .detail {
    color: var(--agent);
  }
  section[aria-label="Working"] .detail {
    color: var(--accent-ink);
  }
  .reason {
    font-size: 13px;
    color: var(--del);
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--ink-3);
  }
  .error {
    color: var(--del);
  }
</style>
