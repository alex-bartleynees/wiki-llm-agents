<script lang="ts">
  import VaultList from "#lib/features/vaults/VaultList.svelte";
  import AppShell from "#lib/ui/layout/AppShell.svelte";
</script>

<AppShell>
  {#snippet vault()}
    <VaultList />
  {/snippet}

  {#snippet note()}
    <article class="placeholder">
      <h1>Nothing open</h1>
      <p>Register a vault and open a note. Notes arrive in slice 1.</p>
    </article>
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
  h1 {
    margin: 0 0 8px;
    font: 600 28px/1.2 var(--font-read);
    color: var(--ink);
  }
  .label {
    font-size: 11px;
  }
</style>
