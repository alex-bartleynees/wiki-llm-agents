<script lang="ts">
  import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
  import { agents } from "#lib/features/agents/agents.svelte.ts";
  import { timeAgo } from "#lib/features/notes/time.ts";
  import { projects } from "#lib/features/projects/projects.svelte.ts";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import NewThreadForm from "./NewThreadForm.svelte";
  import { providers } from "./providers.svelte.ts";
  import { progressLabel, STATUS_LABEL } from "./status.ts";
  import { threads } from "./threads.svelte.ts";

  /**
   * The vault whose threads show, and the project they are narrowed to (null for all).
   * Without `scopeSelect` the list stays on that project (the Projects page).
   */
  let { vaultId, projectId, scopeSelect = true }: { vaultId: string; projectId: string | null; scopeSelect?: boolean } = $props();

  $effect(() => {
    void agents.load();
  });

  /** Active projects that use this vault: the ones its threads can be narrowed to. */
  const vaultProjects = $derived(projects.active.filter((project) => project.vaultId === vaultId));
  const vaultName = $derived(vaults.byId(vaultId)?.name ?? "vault");

  const chosen = $derived(providers.chosen);
</script>

<header>
  {#if scopeSelect}
  <label class="scope">
    <span class="visually-hidden">Threads in</span>
    <select value={projectId ?? ""} onchange={(event) => projects.select(event.currentTarget.value || null)}>
      <option value="">{vaultName} · all threads</option>
      {#each vaultProjects as project (project.id)}
        <option value={project.id}>project · {project.name}</option>
      {/each}
    </select>
  </label>
  {/if}
  <NewThreadForm {vaultId} {projectId} />
</header>

{#if threads.error}
  <p class="error" role="alert">{threads.error}</p>
{/if}

{#if threads.status === "loaded" && threads.threads.length === 0}
  <div class="empty">
    <p>{projectId === null ? "No threads in this vault yet." : "No threads in this project yet."}</p>
    <p class="hint">
      New threads use {chosen?.name ?? "the first provider"}. OpenCode, Claude Code and Codex ask before they edit, run a
      command, or fetch from the web, unless the agent allows it.
    </p>
  </div>
{:else}
  <div class="lists">
    {#if threads.status === "loaded" && threads.open.length === 0}
      <p class="all-done">Every thread here is done. Start a new one, or open a done one to carry on.</p>
    {/if}
    <ul aria-label="Open threads">
      {#each threads.open as thread (thread.id)}
        {@render item(thread)}
      {/each}
    </ul>
    {#if threads.done.length > 0}
      <details class="done" bind:open={threads.showDone}>
        <summary class="mono">done · {threads.done.length}</summary>
        <ul aria-label="Done threads">
          {#each threads.done as thread (thread.id)}
            {@render item(thread)}
          {/each}
        </ul>
      </details>
    {/if}
  </div>
{/if}

{#snippet item(thread: ThreadSummary)}
  <li>
    <button type="button" onclick={() => threads.select(thread.id)}>
      <span class="title">{thread.title ?? "New thread"}</span>
      <span class="meta mono">
        {#if thread.agentId !== null}
          <span class="agent-name">{agents.get(thread.agentId)?.name ?? thread.agentId}</span> ·
        {/if}
        {#if thread.status !== "idle"}
          <span class="status" data-status={thread.status}>{STATUS_LABEL[thread.status]}</span> ·
          {#if thread.runningTurn?.progress}
            <span class="progress">{progressLabel(thread.runningTurn.progress)}</span> ·
          {/if}
        {/if}
        {timeAgo(thread.doneAt ?? thread.updatedAt)}
      </span>
    </button>
  </li>
{/snippet}

<style>
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .scope {
    flex: 1 1 100%;
    display: flex;
  }
  .scope select {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font: inherit;
    height: 36px;
    padding: 0 8px;
    background: var(--surface);
    color: var(--ink);
    font-size: 14px;
  }
  .lists {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
  }
  .all-done {
    margin: 0;
    padding: 16px 16px 4px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .done {
    border-top: 1px solid var(--line-soft);
  }
  .done summary {
    padding: 8px 16px;
    font-size: 12px;
    color: var(--ink-3);
    cursor: pointer;
  }
  .done .title {
    color: var(--ink-2);
  }
  li button {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  li button:hover {
    background: var(--sunken);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 11px;
    color: var(--ink-3);
  }
  .agent-name {
    color: var(--agent);
  }
  .status[data-status="running"] {
    color: var(--accent-ink);
  }
  .status[data-status="waiting"] {
    color: var(--agent);
    font-weight: 500;
  }
  .empty {
    padding: 24px 16px;
    color: var(--ink-3);
  }
  .empty p {
    margin: 0 0 8px;
  }
  .hint {
    font-size: 12px;
  }
  .error {
    margin: 8px 16px;
    color: var(--del);
  }
</style>
