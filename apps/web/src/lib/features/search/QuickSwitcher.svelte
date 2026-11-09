<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { SnippetPart } from "@wiki-agents/contracts/search/model";
  import type { QuickSwitchResult } from "@wiki-agents/contracts/search/quick-switch/response";
  import { viewHref } from "@wiki-agents/contracts/notes/model";
  import { isAbort } from "#lib/api/client.ts";
  import { recent } from "#lib/features/notes/recent.svelte.ts";
  import { pins } from "#lib/features/pins/pins.svelte.ts";
  import { shell, shortcutLabel } from "#lib/ui/layout/shell.svelte.ts";
  import { quickSwitch } from "./api.ts";
  import { folderOf, highlightParts } from "./highlight.ts";
  import Marked from "./Marked.svelte";
  import { search } from "./search.svelte.ts";

  /**
   * ⌘K / Ctrl K: open any note by typing part of its title or path. With nothing
   * typed it lists pinned and recent files. The last row hands the text to full-text
   * search (also ⌘↵). ⌘⇧F / Ctrl Shift F opens full-text search directly.
   */

  type Item =
    | {
        readonly type: "file";
        readonly key: string;
        readonly href: string;
        readonly title: ReadonlyArray<SnippetPart>;
        readonly detail: ReadonlyArray<SnippetPart>;
        /** Set on the first item of a section (Pinned, Recent). */
        readonly heading?: string;
      }
    | { readonly type: "search"; readonly key: string; readonly text: string };

  const vaultId = $derived(page.params["vaultId"]);
  let dialog: HTMLDialogElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let query = $state("");
  let results = $state<ReadonlyArray<QuickSwitchResult>>([]);
  let active = $state(0);

  const plain = (text: string): ReadonlyArray<SnippetPart> => (text === "" ? [] : [{ text, match: false }]);

  /** A section of files with a heading, leaving out files the app can't show. */
  const section = (heading: string, files: ReadonlyArray<{ readonly path: string; readonly title: string }>): Array<Item> => {
    const items: Array<Item> = [];
    for (const file of files) {
      const href = vaultId === undefined ? undefined : viewHref(vaultId, file.path);
      if (href === undefined) continue;
      items.push({
        type: "file",
        key: `${heading}:${file.path}`,
        href,
        title: plain(file.title),
        detail: plain(folderOf(file.path)),
        ...(items.length === 0 ? { heading } : {}),
      });
    }
    return items;
  };

  const items = $derived.by((): ReadonlyArray<Item> => {
    if (query.trim() === "") {
      const pinned = pins.pins.flatMap((pin) => (pin.title === null ? [] : [{ path: pin.path, title: pin.title }]));
      const pinnedPaths = new Set(pinned.map((pin) => pin.path));
      const recentFiles = vaultId === undefined ? [] : recent.list(vaultId);
      return [...section("Pinned", pinned), ...section("Recent", recentFiles.filter((file) => !pinnedPaths.has(file.path)))];
    }
    const found = results.flatMap((result): Array<Item> => {
      const href = vaultId === undefined ? undefined : viewHref(vaultId, result.path);
      if (href === undefined) return [];
      const byTitle = result.match.field === "title";
      return [
        {
          type: "file",
          key: result.path,
          href,
          title: byTitle ? highlightParts(result.title, result.match.positions) : plain(result.title),
          detail: byTitle ? plain(folderOf(result.path)) : highlightParts(result.path, result.match.positions),
        },
      ];
    });
    return [...found, { type: "search", key: "search", text: query.trim() }];
  });

  // Open and close the modal with the store, so the header button and shortcuts can open it.
  $effect(() => {
    if (!dialog) return;
    if (shell.switcherOpen && !dialog.open) {
      query = "";
      results = [];
      active = 0;
      dialog.showModal();
      input?.focus();
    } else if (!shell.switcherOpen && dialog.open) {
      dialog.close();
    }
  });

  $effect(() => {
    const q = query;
    const id = vaultId;
    if (id === undefined || q.trim() === "") {
      results = [];
      return;
    }
    const controller = new AbortController();
    quickSwitch(id, q, controller.signal).then(
      (response) => {
        results = response.results;
        active = 0;
      },
      (error) => {
        if (!isAbort(error)) results = [];
      },
    );
    return () => controller.abort();
  });

  $effect(() => {
    document.getElementById(`switcher-option-${active}`)?.scrollIntoView({ block: "nearest" });
  });

  const close = () => (shell.switcherOpen = false);

  const choose = (item: Item | undefined, options: { readonly searchInstead?: boolean } = {}) => {
    if (options.searchInstead || item?.type === "search") {
      close();
      search.open(query.trim());
    } else if (item?.type === "file") {
      close();
      void goto(item.href);
    }
  };

  const onkeydown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      event.preventDefault();
      active = items.length === 0 ? 0 : (active + 1) % items.length;
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      event.preventDefault();
      active = items.length === 0 ? 0 : (active - 1 + items.length) % items.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[active], { searchInstead: (event.metaKey || event.ctrlKey) && query.trim() !== "" });
    }
  };

  const onWindowKeydown = (event: KeyboardEvent) => {
    if (vaultId === undefined || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k" && !event.shiftKey) {
      event.preventDefault();
      shell.switcherOpen = !shell.switcherOpen;
    } else if (key === "f" && event.shiftKey) {
      event.preventDefault();
      close();
      search.open();
    }
  };
</script>

<svelte:window onkeydown={onWindowKeydown} />

<dialog
  bind:this={dialog}
  aria-label="Open a note"
  onclose={close}
  onclick={(event) => event.target === dialog && close()}
>
  <div class="box">
    <input
      bind:this={input}
      bind:value={query}
      {onkeydown}
      type="text"
      role="combobox"
      aria-label="Note title or path"
      aria-expanded="true"
      aria-controls="switcher-options"
      aria-autocomplete="list"
      aria-activedescendant={items.length > 0 ? `switcher-option-${active}` : undefined}
      placeholder="Open a note…"
      autocomplete="off"
      spellcheck="false"
    />
    <ul id="switcher-options" role="listbox" aria-label="Notes">
      {#each items as item, index (item.key)}
        {#if item.type === "file" && item.heading}
          <li role="presentation" class="section mono">{item.heading}</li>
        {/if}
        <!-- The input keeps focus and handles the keyboard; options only need the pointer. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="switcher-option-{index}"
          role="option"
          aria-selected={index === active}
          class:search-row={item.type === "search"}
          onclick={() => choose(item)}
          onpointermove={() => (active = index)}
        >
          {#if item.type === "file"}
            <span class="title"><Marked parts={item.title} /></span>
            {#if item.detail.length > 0}<span class="detail mono"><Marked parts={item.detail} /></span>{/if}
          {:else}
            <span class="title">Search all notes for “{item.text}”</span>
            <kbd class="mono">{shortcutLabel("↵")}</kbd>
          {/if}
        </li>
      {/each}
    </ul>
    {#if items.length === 0}
      <p class="empty">{query.trim() === "" ? "Pinned and recent notes show here." : "No matches."}</p>
    {/if}
    <p class="hints mono" aria-hidden="true"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></p>
  </div>
</dialog>

<style>
  dialog {
    width: min(640px, calc(100vw - 32px));
    max-height: min(560px, calc(100dvh - 24vh));
    margin: 12vh auto auto;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.25);
    overflow: hidden;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  .box {
    display: flex;
    flex-direction: column;
    max-height: inherit;
  }
  input {
    flex: 0 0 auto;
    height: 48px;
    padding: 0 16px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: transparent;
    font: inherit;
    font-size: 16px;
    color: var(--ink);
  }
  input:focus {
    outline: none;
  }
  ul {
    flex: 1 1 auto;
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow: auto;
  }
  ul:empty {
    display: none;
  }
  .section {
    padding: 8px 10px 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  [role="option"] {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-height: 36px;
    padding: 8px 10px;
    border-radius: var(--radius);
    cursor: pointer;
  }
  [role="option"][aria-selected="true"] {
    background: var(--sunken);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .title {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--ink-3);
  }
  .search-row {
    border-top: 1px solid var(--line-soft);
    color: var(--ink-2);
  }
  .search-row .title {
    flex: 1 1 auto;
  }
  kbd {
    font-size: 11px;
    color: var(--ink-3);
  }
  .empty {
    margin: 0;
    padding: 16px;
    color: var(--ink-3);
  }
  .hints {
    display: flex;
    gap: 16px;
    margin: 0;
    padding: 8px 16px;
    border-top: 1px solid var(--line);
    font-size: 11px;
    color: var(--ink-3);
  }
  @media (max-width: 899px) {
    dialog {
      width: 100vw;
      max-width: none;
      max-height: 100dvh;
      height: 100dvh;
      margin: 0;
      border: 0;
      border-radius: 0;
    }
    [role="option"] {
      min-height: 44px;
    }
    .hints {
      display: none;
    }
  }
</style>
