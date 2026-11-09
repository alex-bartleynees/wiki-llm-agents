<script lang="ts">
  import { untrack } from "svelte";
  import ThreadList from "./ThreadList.svelte";
  import ThreadView from "./ThreadView.svelte";
  import { openThread } from "./open-thread.svelte.ts";
  import { threads } from "./threads.svelte.ts";

  let { vaultId }: { vaultId: string } = $props();

  // Connecting talks to the server; the store ignores a vault it already follows.
  // Untracked, so the store's own state never re-runs this effect.
  $effect(() => {
    const id = vaultId;
    untrack(() => threads.connect(id));
  });
</script>

<div class="pane">
  {#if openThread.status === "empty"}
    <ThreadList />
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
</style>
