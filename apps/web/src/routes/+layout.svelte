<script lang="ts">
  import "#lib/ui/tokens.css";
  import VaultPane from "#lib/features/notes/VaultPane.svelte";
  import QuickSwitcher from "#lib/features/search/QuickSwitcher.svelte";
  import SearchPanel from "#lib/features/search/SearchPanel.svelte";
  import AppShell from "#lib/ui/layout/AppShell.svelte";
  import { shell } from "#lib/ui/layout/shell.svelte.ts";

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
    <!-- Desktop shows search in the vault sidebar instead. -->
    {#if shell.phone.current}
      <SearchPanel />
    {/if}
  {/snippet}
</AppShell>

<QuickSwitcher />

<style>
  .placeholder {
    padding: 32px;
    color: var(--ink-3);
  }
  .label {
    font-size: 11px;
  }
</style>
