<script lang="ts">
  import type { Snippet } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import Splitter from "#lib/ui/primitives/Splitter.svelte";
  import { theme } from "#lib/ui/theme.svelte.ts";
  import BottomBar from "./BottomBar.svelte";
  import { paneWidths, THREADS_PANE, VAULT_PANE } from "./pane-widths.svelte.ts";
  import { shell } from "./shell.svelte.ts";

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

  // Phone: opening a note (from the drawer or a link) shows it full screen.
  afterNavigate(() => {
    shell.drawerOpen = false;
    shell.tab = "wiki";
  });
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && (shell.drawerOpen = false)} />

<div class="app" data-tab={shell.tab}>
  <header>
    <button
      type="button"
      class="icon drawer-toggle"
      aria-label="Vault"
      aria-expanded={shell.drawerOpen}
      onclick={() => (shell.drawerOpen = !shell.drawerOpen)}
    >
      ☰
    </button>
    <a class="brand" href="/">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="17" height="17" rx="2" stroke="var(--ink)" stroke-width="1.5" />
        <path d="M6 6.5h8M6 10h5" stroke="var(--accent)" stroke-width="1.5" />
      </svg>
      wiki-agents
    </a>
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

  <div class="panes" style:--vault-width="{paneWidths.vault}px" style:--threads-width="{paneWidths.threads}px">
    {#if shell.drawerOpen}
      <button type="button" class="backdrop" aria-label="Close vault" onclick={() => (shell.drawerOpen = false)}></button>
    {/if}
    <aside class="vault" class:open={shell.drawerOpen} aria-label="Vault">
      {@render vault()}
    </aside>
    <Splitter
      label="Resize vault sidebar"
      edge="start"
      value={paneWidths.vault}
      {...VAULT_PANE}
      onresize={(width) => paneWidths.setVault(width)}
      oncommit={() => paneWidths.save()}
    />
    <main class="note">{@render note()}</main>
    <Splitter
      label="Resize threads sidebar"
      edge="end"
      value={paneWidths.threads}
      {...THREADS_PANE}
      onresize={(width) => paneWidths.setThreads(width)}
      oncommit={() => paneWidths.save()}
    />
    <aside class="threads" aria-label="Agent threads">{@render threads()}</aside>
    <section class="agents" aria-label="Agents">{@render agents()}</section>
    <section class="search-pane" aria-label="Search">{@render search()}</section>
  </div>

  <div class="bottom-bar">
    <BottomBar active={shell.tab} onselect={(next) => ((shell.tab = next), (shell.drawerOpen = false))} />
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
    color: var(--ink);
    text-decoration: none;
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
  /*
   * Sidebars take the width set with the splitters; when the window is too narrow,
   * they shrink (down to their minimum) before the note goes below 400px.
   */
  .vault {
    flex: 0 1 var(--vault-width);
    min-width: 180px;
    padding: 18px 12px;
    border-right: 1px solid var(--line);
    overflow: auto;
  }
  .note {
    flex: 1 1 0;
    min-width: 400px;
    background: var(--surface);
    overflow: auto;
  }
  .threads {
    flex: 0 1 var(--threads-width);
    min-width: 260px;
    border-left: 1px solid var(--line);
    overflow: auto;
  }
  .agents,
  .search-pane,
  .bottom-bar,
  .backdrop,
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
      min-width: 0;
      max-width: none;
      border: 0;
    }
    .panes > :global(.splitter) {
      display: none;
    }
    .vault {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 2;
      width: min(300px, 85vw);
      min-width: 0;
      max-width: none;
      background: var(--bg);
      transform: translateX(-100%);
      transition: transform 150ms ease;
    }
    .vault.open {
      box-shadow: 0 0 24px rgb(0 0 0 / 0.15);
      transform: none;
    }
    .backdrop {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 1;
      border: 0;
      background: rgb(0 0 0 / 0.3);
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
