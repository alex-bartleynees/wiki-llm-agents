<script lang="ts">
  import { untrack } from "svelte";
  import { vaults } from "./vaults.svelte.ts";

  // Untracked: the load reads the store's state, which would re-run this effect.
  $effect(() => {
    untrack(() => void vaults.load());
  });
</script>

{#if vaults.state.status === "loading"}
  <p class="muted">Loading…</p>
{:else if vaults.state.status === "failed"}
  <p class="muted">Couldn't reach the server: {vaults.state.message}</p>
  <button type="button" onclick={() => vaults.load(true)}>Retry</button>
{:else if vaults.state.vaults.length === 0}
  <p class="muted">No vaults yet.</p>
{:else}
  <ul>
    {#each vaults.state.vaults as vault (vault.id)}
      <li>
        <a class="name" href="/vaults/{vault.id}">{vault.name}</a>
        <span class="path mono">{vault.rootPath}</span>
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
    gap: 2px;
    padding: 10px 12px;
  }
  li + li {
    border-top: 1px solid var(--line-soft);
  }
  .name {
    font-weight: 600;
    text-decoration: none;
  }
  .path {
    font-size: 12px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  button {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    color: var(--ink-2);
    cursor: pointer;
  }
</style>
