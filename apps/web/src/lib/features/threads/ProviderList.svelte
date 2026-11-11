<script lang="ts">
  import { untrack } from "svelte";
  import { providers } from "./providers.svelte.ts";

  // Checks each provider once when the list arrives (OpenCode's check starts its server).
  $effect(() => {
    untrack(() =>
      void providers.load().then(() => {
        for (const provider of providers.list) void providers.check(provider.id);
      }),
    );
  });
</script>

{#if providers.list.length === 0}
  <p class="muted">Loading…</p>
{:else}
  <ul aria-label="Providers">
    {#each providers.list as provider (provider.id)}
      {@const status = providers.statuses[provider.id]}
      <li aria-label={provider.name}>
        <div class="row">
          <span class="name">{provider.name}</span>
          {#if status === undefined || status === "checking"}
            <span class="badge">Checking…</span>
          {:else if status._tag === "ready"}
            <span class="badge ready">Ready</span>
          {:else}
            <span class="badge unavailable">Unavailable</span>
          {/if}
          <button type="button" disabled={status === "checking"} onclick={() => providers.check(provider.id, true)}>Check again</button>
        </div>
        {#if status !== undefined && status !== "checking"}
          {#if status._tag === "ready"}
            <p class="detail">
              {#if status.version !== null}<span>Version <span class="mono">{status.version}</span></span>{/if}
              {#if status.account !== null}<span>Signed in as {status.account}</span>{/if}
              {#if status.version === null && status.account === null}<span>Built in</span>{/if}
            </p>
          {:else}
            <p class="detail reason">{status.reason}</p>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .muted {
    margin: 0 0 8px;
    color: var(--ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  li {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
  }
  li + li {
    border-top: 1px solid var(--line-soft);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .name {
    font-weight: 600;
  }
  .badge {
    font-size: 12px;
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--ink-3);
  }
  .badge.ready {
    color: var(--ok);
    border-color: currentColor;
  }
  .badge.unavailable {
    color: var(--warn);
    border-color: currentColor;
  }
  button {
    margin-left: auto;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    font-size: 13px;
    color: var(--ink-2);
    cursor: pointer;
  }
  .detail {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    font-size: 13px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
</style>
