<script lang="ts">
  import "#lib/ui/tokens.css";
  import VaultPane from "#lib/features/notes/VaultPane.svelte";
  import AppShell from "#lib/ui/layout/AppShell.svelte";

  let { children } = $props();
</script>

<AppShell>
  {#snippet vault()}
    <VaultPane />
  {/snippet}

  {#snippet note()}
    {@render children()}
  {/snippet}

  {#snippet threads()}
    <div class="placeholder">
      <p class="mono label">threads</p>
      <p>Agent threads arrive in M2.</p>
    </div>
  {/snippet}

  {#snippet agents()}
    <div class="placeholder"><p>Agents arrive in M2.</p></div>
  {/snippet}

  {#snippet search()}
    <div class="placeholder"><p>Search arrives in slice 3.</p></div>
  {/snippet}
</AppShell>

<style>
  .placeholder {
    padding: 32px;
    color: var(--ink-3);
  }
  .label {
    font-size: 11px;
  }
</style>
