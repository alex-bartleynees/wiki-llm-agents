<script lang="ts">
  import "#lib/ui/tokens.css";
  import { page } from "$app/state";
  import AgentsPane from "#lib/features/agents/AgentsPane.svelte";
  import VaultPane from "#lib/features/notes/VaultPane.svelte";
  import QuickSwitcher from "#lib/features/search/QuickSwitcher.svelte";
  import SearchPanel from "#lib/features/search/SearchPanel.svelte";
  import ThreadsPane from "#lib/features/threads/ThreadsPane.svelte";
  import AppShell from "#lib/ui/layout/AppShell.svelte";
  import { shell } from "#lib/ui/layout/shell.svelte.ts";

  let { children } = $props();

  const vaultId = $derived(page.params["vaultId"]);
</script>

<AppShell>
  {#snippet vault()}
    <VaultPane />
  {/snippet}

  {#snippet note()}
    {@render children()}
  {/snippet}

  {#snippet threads()}
    {#if vaultId}
      {#key vaultId}
        <ThreadsPane {vaultId} />
      {/key}
    {:else}
      <div class="placeholder"><p>Open a vault to talk to agents about it.</p></div>
    {/if}
  {/snippet}

  {#snippet agents()}
    <!-- Desktop shows agents in the right-hand pane instead. -->
    {#if shell.phone.current}
      <AgentsPane />
    {/if}
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
</style>
