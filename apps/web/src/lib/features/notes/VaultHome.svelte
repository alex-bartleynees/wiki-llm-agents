<script lang="ts">
  import { noteHref } from "@wiki-agents/contracts/notes/model";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import { shell } from "#lib/ui/layout/shell.svelte.ts";
  import { tree } from "./tree.svelte.ts";

  let { vaultId }: { vaultId: string } = $props();

  const vault = $derived(vaults.byId(vaultId));
  const starts = $derived(
    tree.state.status === "loaded" && tree.vaultId === vaultId
      ? ["index.md", "README.md", "Home.md"].filter((path) => tree.hasNote(path))
      : [],
  );

  $effect(() => {
    if (vault) vaults.remember(vault.id);
  });
</script>

<svelte:head>
  <title>{vault?.name ?? "Vault"} · wiki-agents</title>
</svelte:head>

<section>
  {#if vaults.state.status === "loaded" && vault === undefined}
    <h1>Vault not found</h1>
    <p class="muted">It may have been removed. <a href="/settings">Manage vaults</a></p>
  {:else}
    <h1>{vault?.name ?? ""}</h1>
    <p class="muted mono">{vault?.rootPath ?? ""}</p>
    {#if tree.state.status === "loaded" && tree.vaultId === vaultId}
      <p class="muted">{tree.state.count} files. Pick a note from the tree.</p>
    {/if}
    <div class="actions">
      {#each starts as path (path)}
        <a class="button" href={noteHref(vaultId, path)}>Open {path}</a>
      {/each}
      <button type="button" class="button browse" onclick={() => shell.openDrawer()}>Browse files</button>
    </div>
  {/if}
</section>

<style>
  section {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px;
  }
  h1 {
    margin: 0 0 6px;
    font: 600 30px/1.2 var(--font-read);
  }
  .muted {
    margin: 0 0 10px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
  }
  .button {
    display: inline-flex;
    align-items: center;
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    color: var(--ink-2);
    text-decoration: none;
    cursor: pointer;
  }
  .browse {
    display: none;
  }
  @media (max-width: 899px) {
    section {
      padding: 24px 18px;
    }
    .browse {
      display: inline-flex;
    }
  }
</style>
