<script lang="ts">
  import { untrack } from "svelte";
  import AgentsPane from "#lib/features/agents/AgentsPane.svelte";
  import { shell } from "#lib/ui/layout/shell.svelte.ts";
  import ThreadList from "./ThreadList.svelte";
  import ThreadView from "./ThreadView.svelte";
  import { openThread } from "./open-thread.svelte.ts";
  import { threads } from "./threads.svelte.ts";

  /** `projectId`: the project whose threads to show; null for the vault's own threads. */
  let { vaultId, projectId }: { vaultId: string; projectId: string | null } = $props();

  // Connecting talks to the server; the store ignores a scope it already follows.
  // Untracked, so the store's own state never re-runs this effect.
  $effect(() => {
    const scope = { vaultId, projectId };
    untrack(() => threads.connect(scope));
  });

  /** Desktop shares this pane between threads and agents; phone has an Agents tab instead. */
  const showAgents = $derived(!shell.phone.current && shell.sidePane === "agents");
</script>

<div class="pane">
  {#if !shell.phone.current}
    <div class="switch" role="tablist" aria-label="Right pane">
      <button type="button" role="tab" aria-selected={!showAgents} onclick={() => (shell.sidePane = "threads")}>Threads</button>
      <button type="button" role="tab" aria-selected={showAgents} onclick={() => (shell.sidePane = "agents")}>Agents</button>
    </div>
  {/if}
  {#if showAgents}
    <AgentsPane />
  {:else if openThread.status === "empty"}
    <ThreadList {vaultId} {projectId} />
  {:else}
    <ThreadView />
  {/if}
</div>

<style>
  .pane {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .switch {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
    padding: 6px 10px 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .switch button {
    padding: 6px 10px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .switch button[aria-selected="true"] {
    border-bottom-color: var(--accent);
    color: var(--ink);
    font-weight: 500;
  }
</style>
