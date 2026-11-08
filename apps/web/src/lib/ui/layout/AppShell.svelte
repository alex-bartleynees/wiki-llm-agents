<script lang="ts">
  import type { Snippet } from "svelte";
  import { theme } from "#lib/ui/theme.svelte.ts";
  import BottomBar, { type Tab } from "./BottomBar.svelte";

  let {
    vault,
    note,
    threads,
    agents,
    search,
  }: {
    vault: Snippet;
    note: Snippet;
    threads: Snippet;
    agents: Snippet;
    search: Snippet;
  } = $props();

  // Phone only: which pane fills the screen, and whether the vault drawer is open.
  let tab = $state<Tab>("wiki");
  let drawerOpen = $state(false);
</script>

<div class="app" data-tab={tab}>
  <header>
    <button
      type="button"
      class="icon drawer-toggle"
      aria-label="Vault"
      aria-expanded={drawerOpen}
      onclick={() => (drawerOpen = !drawerOpen)}
    >
      ☰
    </button>
    <span class="brand">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="17" height="17" rx="2" stroke="var(--ink)" stroke-width="1.5" />
        <path d="M6 6.5h8M6 10h5" stroke="var(--accent)" stroke-width="1.5" />
      </svg>
      wiki-agents
    </span>
    <label class="search">
      <span class="visually-hidden">Search</span>
      <input type="search" placeholder="Search or ask the vault" disabled />
      <kbd class="mono">⌘K</kbd>
    </label>
    <button
      type="button"
      class="icon"
      aria-label={theme.current === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onclick={() => theme.toggle()}
    >
      {theme.current === "dark" ? "☀" : "☾"}
    </button>
  </header>

  <div class="panes">
    <aside class="vault" class:open={drawerOpen} aria-label="Vault">
      {@render vault()}
    </aside>
    <main class="note">{@render note()}</main>
    <aside class="threads" aria-label="Agent threads">{@render threads()}</aside>
    <section class="agents" aria-label="Agents">{@render agents()}</section>
    <section class="search-pane" aria-label="Search">{@render search()}</section>
  </div>

  <div class="bottom-bar">
    <BottomBar active={tab} onselect={(next) => ((tab = next), (drawerOpen = false))} />
  </div>
</div>

<style>
  .app {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  header {
    flex: 0 0 auto;
    min-height: var(--header-height);
    padding: 0 20px;
    display: flex;
    align-items: center;
    gap: 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .search {
    flex: 1 1 260px;
    max-width: 480px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink-3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: var(--ink);
  }
  .search input:focus {
    outline: none;
  }
  kbd {
    font-size: 11px;
  }
  .icon {
    width: 36px;
    height: 36px;
    margin-left: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .search + .icon {
    margin-left: 0;
  }

  .panes {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  .vault {
    flex: 1 1 240px;
    max-width: 264px;
    padding: 18px 12px;
    border-right: 1px solid var(--line);
    overflow: auto;
  }
  .note {
    flex: 999 1 560px;
    min-width: 0;
    background: var(--surface);
    overflow: auto;
  }
  .threads {
    flex: 1 1 340px;
    max-width: 400px;
    border-left: 1px solid var(--line);
    overflow: auto;
  }
  .agents,
  .search-pane,
  .bottom-bar,
  .drawer-toggle {
    display: none;
  }

  /* Phone: one pane at a time, chosen by the bottom bar; the vault tree is a drawer. */
  @media (max-width: 899px) {
    header {
      padding: 0 12px;
      gap: 10px;
    }
    .search {
      display: none;
    }
    .drawer-toggle {
      display: block;
      margin-left: 0;
    }
    .panes {
      position: relative;
    }
    .note,
    .threads {
      display: none;
      flex: 1 1 auto;
      max-width: none;
      border: 0;
    }
    .vault {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 1;
      width: min(300px, 85vw);
      max-width: none;
      background: var(--bg);
      transform: translateX(-100%);
      transition: transform 150ms ease;
      box-shadow: 0 0 24px rgb(0 0 0 / 0.15);
    }
    .vault.open {
      transform: none;
    }
    .app[data-tab="wiki"] .note,
    .app[data-tab="chat"] .threads,
    .app[data-tab="agents"] .agents,
    .app[data-tab="search"] .search-pane {
      display: block;
      flex: 1 1 auto;
      overflow: auto;
    }
    .bottom-bar {
      display: block;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .vault {
      transition: none;
    }
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
