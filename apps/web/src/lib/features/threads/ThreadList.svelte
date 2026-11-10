<script lang="ts">
  import { timeAgo } from "#lib/features/notes/time.ts";
  import { providers } from "./providers.svelte.ts";
  import { STATUS_LABEL } from "./status.ts";
  import { threads } from "./threads.svelte.ts";

  $effect(() => {
    void providers.load().then(() => {
      const chosen = providers.chosen;
      if (chosen !== undefined) void providers.check(chosen.id);
    });
  });

  const chosen = $derived(providers.chosen);
  const status = $derived(chosen === undefined ? undefined : providers.statuses[chosen.id]);
</script>

<header>
  <h2 class="mono">Threads</h2>
  <div class="start">
    {#if providers.list.length > 1}
      <select
        aria-label="Provider for new threads"
        value={chosen?.id}
        onchange={(event) => providers.choose(event.currentTarget.value)}
      >
        {#each providers.list as provider (provider.id)}
          <option value={provider.id}>{provider.name}</option>
        {/each}
      </select>
    {/if}
    <button type="button" class="new" onclick={() => threads.create()}>New thread</button>
  </div>
</header>

{#if status !== undefined && status !== "checking" && status._tag === "unavailable"}
  <p class="warning" role="status">{chosen?.name} can't run turns: {status.reason}</p>
{/if}

{#if threads.error}
  <p class="error" role="alert">{threads.error}</p>
{/if}

{#if threads.status === "loaded" && threads.threads.length === 0}
  <div class="empty">
    <p>No threads in this vault yet.</p>
    <p class="hint">
      New threads use {chosen?.name ?? "the first provider"}. Replay plays recorded turns and spends no tokens; OpenCode
      asks before it edits, runs a command, or fetches from the web.
    </p>
  </div>
{:else}
  <ul>
    {#each threads.threads as thread (thread.id)}
      <li>
        <button type="button" onclick={() => threads.select(thread.id)}>
          <span class="title">{thread.title ?? "New thread"}</span>
          <span class="meta mono">
            {#if thread.status !== "idle"}
              <span class="status" data-status={thread.status}>{STATUS_LABEL[thread.status]}</span> ·
            {/if}
            {timeAgo(thread.updatedAt)}
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  h2 {
    margin: 0;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .start {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  select {
    min-width: 0;
    height: 30px;
    padding: 0 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink-2);
    font: inherit;
    font-size: 12px;
  }
  .warning {
    margin: 8px 16px 0;
    font-size: 12px;
    color: var(--agent);
  }
  .new {
    flex: 0 0 auto;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow: auto;
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
