<script lang="ts">
  import "#lib/ui/tokens.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import AgentsPane from "#lib/features/agents/AgentsPane.svelte";
  import VaultPane from "#lib/features/notes/VaultPane.svelte";
  import { projects } from "#lib/features/projects/projects.svelte.ts";
  import QuickSwitcher from "#lib/features/search/QuickSwitcher.svelte";
  import SearchPanel from "#lib/features/search/SearchPanel.svelte";
  import ThreadsPane from "#lib/features/threads/ThreadsPane.svelte";
  import AppShell from "#lib/ui/layout/AppShell.svelte";
  import { shell } from "#lib/ui/layout/shell.svelte.ts";
  import { projectShownWith } from "#lib/features/threads/thread-scope.ts";

  let { children } = $props();

  onMount(() => {
    void projects.load();
  });

  const vaultId = $derived(page.params["vaultId"]);
  /** The selected project narrows the threads pane when it uses the open vault. */
  const projectId = $derived(vaultId === undefined ? null : projectShownWith(vaultId, projects.selected));
  /** Projects is a page of its own, without the vault and threads panes. */
  const full = $derived(page.url.pathname.startsWith("/projects"));
</script>

<AppShell {full}>
  {#snippet vault()}
    <VaultPane />
  {/snippet}

  {#snippet note()}
    {@render children()}
  {/snippet}

  {#snippet threads()}
    {#if vaultId}
      {#key vaultId}
        <ThreadsPane {vaultId} {projectId} />
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
