<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { VIEW_PARAMS } from "@wiki-agents/contracts/notes/model";
  import { vaultEvents } from "#lib/features/indexing/vault-events.svelte.ts";
  import PinnedNotes from "#lib/features/pins/PinnedNotes.svelte";
  import { pins } from "#lib/features/pins/pins.svelte.ts";
  import SearchPanel from "#lib/features/search/SearchPanel.svelte";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import { shell, shortcutLabel } from "#lib/ui/layout/shell.svelte.ts";
  import FileTree from "./FileTree.svelte";
  import { tree } from "./tree.svelte.ts";

  const vaultId = $derived(page.params["vaultId"]);
  /** The file open in any view (note, page, or JSON), to highlight it in the tree. */
  const current = $derived(
    Object.values(VIEW_PARAMS)
      .map((param) => page.url.searchParams.get(param))
      .find((path) => path !== null) ?? undefined,
  );

  // Each effect reads only its triggers and loads untracked: a load reads and writes
  // its store's state, and tracking that re-ran the effect on every failure, retrying
  // in a tight loop while the server was down.
  $effect(() => {
    untrack(() => void vaults.load());
  });

  // Follow the open vault's changes, and keep the tree current.
  $effect(() => {
    const id = vaultId;
    untrack(() => (id === undefined ? vaultEvents.disconnect() : vaultEvents.connect(id)));
  });

  $effect(() => {
    const id = vaultId;
    if (id !== undefined) untrack(() => void tree.load(id));
  });

  $effect(() => {
    const id = vaultId;
    if (vaultEvents.revision > 0 && id !== undefined) untrack(() => void tree.load(id, { refresh: true }));
  });

  // Pins: titles change and files go missing as the vault changes.
  $effect(() => {
    const id = vaultId;
    const refresh = vaultEvents.revision > 0;
    if (id !== undefined) untrack(() => void pins.load(id, { refresh }));
  });

  /** On phone the drawer only holds files: search has its own tab. */
  const showSearch = $derived(shell.sidebar === "search" && !shell.phone.current);
</script>

<div class="pane">
  <div class="head">
    {#if vaults.list.length > 1}
      <label class="visually-hidden" for="vault-switcher">Vault</label>
      <select id="vault-switcher" value={vaultId} onchange={(event) => goto(`/vaults/${event.currentTarget.value}`)}>
        {#each vaults.list as vault (vault.id)}
          <option value={vault.id}>{vault.name}</option>
        {/each}
      </select>
    {:else}
      <h2 class="vault-name">{vaults.byId(vaultId)?.name ?? "Vaults"}</h2>
    {/if}
    <a class="settings" href="/settings" aria-label="Vault settings" title="Vault settings">⚙</a>
  </div>

  {#if vaultId === undefined}
    {#if vaults.state.status === "loaded" && vaults.list.length > 0}
      <ul class="vaults">
        {#each vaults.list as vault (vault.id)}
          <li><a href="/vaults/{vault.id}">{vault.name}</a></li>
        {/each}
      </ul>
    {:else if vaults.state.status === "failed"}
      <p class="muted">Couldn't reach the server: {vaults.state.message}</p>
    {:else if vaults.state.status === "loaded"}
      <p class="muted">No vaults yet. <a href="/settings">Add one</a>.</p>
    {/if}
  {:else}
    <div class="modes" role="group" aria-label="Sidebar">
      <button type="button" aria-pressed={!showSearch} onclick={() => (shell.sidebar = "files")}>Files</button>
      <button
        type="button"
        aria-pressed={showSearch}
        title="Search notes ({shortcutLabel('⇧F')})"
        onclick={() => (shell.sidebar = "search")}
      >
        Search
      </button>
    </div>

    {#if showSearch}
      <SearchPanel />
    {:else if tree.state.status === "loaded" && tree.vaultId === vaultId}
      <PinnedNotes {vaultId} {current} />
      <FileTree {vaultId} root={tree.state.root} {current} />
    {:else if tree.state.status === "failed"}
      <p class="muted">{tree.state.message}</p>
      <button type="button" onclick={() => tree.load(vaultId, { refresh: true })}>Retry</button>
    {:else}
      <p class="muted">Loading…</p>
    {/if}
  {/if}
</div>

<style>
  .pane {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 0 8px 8px;
  }
  .vault-name {
    flex: 1;
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  select {
    flex: 1;
    min-width: 0;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    font-weight: 600;
    color: var(--ink);
  }
  .settings {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius);
    color: var(--ink-3);
    text-decoration: none;
  }
  .settings:hover {
    background: var(--sunken);
    color: var(--ink);
  }
  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--sunken);
  }
  .modes button {
    justify-self: stretch;
    height: 26px;
    margin: 0;
    padding: 0;
    border: 0;
    font-size: 12px;
    color: var(--ink-3);
  }
  .modes button[aria-pressed="true"] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  }
  @media (max-width: 899px) {
    .modes {
      display: none;
    }
  }
  .vaults {
    list-style: none;
    margin: 0;
    padding: 0 8px;
    display: grid;
    gap: 6px;
  }
  .muted {
    margin: 0;
    padding: 0 8px;
    color: var(--ink-3);
  }
  button {
    justify-self: start;
    height: 32px;
    margin-left: 8px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    color: var(--ink-2);
    cursor: pointer;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
