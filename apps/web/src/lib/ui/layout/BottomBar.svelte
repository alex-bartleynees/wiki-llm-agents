<script lang="ts" module>
  export type Tab = "wiki" | "chat" | "agents" | "search";
  export const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
    { id: "wiki", label: "Wiki" },
    { id: "chat", label: "Chat" },
    { id: "agents", label: "Agents" },
    { id: "search", label: "Search" },
  ];
</script>

<script lang="ts">
  let { active, onselect }: { active: Tab; onselect: (tab: Tab) => void } = $props();
</script>

<nav aria-label="Primary">
  {#each TABS as tab (tab.id)}
    <button
      type="button"
      aria-current={active === tab.id ? "page" : undefined}
      onclick={() => onselect(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>

<style>
  nav {
    flex: 0 0 auto;
    height: calc(var(--bottom-bar-height) + env(safe-area-inset-bottom));
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    background: var(--surface);
  }
  button {
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 12px;
    color: var(--ink-3);
    cursor: pointer;
  }
  button[aria-current="page"] {
    color: var(--accent-ink);
    font-weight: 600;
  }
</style>
