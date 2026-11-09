<script lang="ts">
  import { pins } from "./pins.svelte.ts";

  let { vaultId, path }: { vaultId: string; path: string } = $props();

  const pinned = $derived(pins.vaultId === vaultId && pins.isPinned(path));
  let busy = $state(false);

  const toggle = async () => {
    busy = true;
    await pins.toggle(vaultId, path);
    busy = false;
  };
</script>

<button
  type="button"
  class:pinned
  aria-pressed={pinned}
  disabled={busy}
  title={pins.error ?? (pinned ? "Unpin" : "Pin to the top of the sidebar")}
  onclick={toggle}
>
  <span aria-hidden="true">{pinned ? "★" : "☆"}</span>
  {pinned ? "Pinned" : "Pin"}
</button>

<style>
  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    font: inherit;
    color: var(--ink-3);
    cursor: pointer;
  }
  button:hover {
    color: var(--ink);
  }
  .pinned {
    border-color: transparent;
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  @media (max-width: 899px) {
    button {
      padding: 4px 10px;
    }
  }
</style>
