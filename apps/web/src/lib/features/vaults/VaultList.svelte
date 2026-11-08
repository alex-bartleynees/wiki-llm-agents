<script lang="ts">
  import { onMount } from "svelte";
  import { vaults } from "./vaults.svelte.ts";

  onMount(() => {
    void vaults.load();
  });
</script>

<section aria-label="Vaults">
  <h2 class="label mono">vaults/</h2>
  {#if vaults.state.status === "loading"}
    <p class="muted">Loading…</p>
  {:else if vaults.state.status === "failed"}
    <p class="muted">Couldn't reach the server: {vaults.state.message}</p>
    <button type="button" onclick={() => vaults.load()}>Retry</button>
  {:else if vaults.state.vaults.length === 0}
    <p class="muted">No vaults yet. Registering a vault comes in slice 1.</p>
  {:else}
    <ul>
      {#each vaults.state.vaults as vault (vault.id)}
        <li>
          <span class="name">{vault.name}</span>
          <span class="path mono">{vault.rootPath}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .label {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-3);
    text-transform: lowercase;
  }
  .muted {
    margin: 0 0 8px;
    color: var(--ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  li {
    display: grid;
    padding: 6px 8px;
    border-radius: var(--radius);
  }
  li:hover {
    background: var(--sunken);
  }
  .name {
    color: var(--ink);
  }
  .path {
    font-size: 11px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
