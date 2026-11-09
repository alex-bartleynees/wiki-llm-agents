<script lang="ts">
  import { vaultFileHref, viewHref } from "@wiki-agents/contracts/notes/model";
  import { tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { ancestorsOf, type TreeFolder } from "./tree.ts";

  let {
    vaultId,
    root,
    current,
  }: { vaultId: string; root: TreeFolder; current: string | undefined } = $props();

  const expanded = new SvelteSet<string>();
  let list: HTMLUListElement | undefined = $state();

  // Collapse everything when switching vaults.
  $effect(() => {
    void vaultId;
    expanded.clear();
  });

  // Reveal the open note: expand its folders and scroll it into view.
  $effect(() => {
    if (current === undefined) return;
    for (const folder of ancestorsOf(current)) expanded.add(folder);
    void tick().then(() => list?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" }));
  });

  const toggle = (path: string) => {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
  };
</script>

{#snippet folder(node: TreeFolder, depth: number)}
  {#each node.folders as child (child.path)}
    {@const open = expanded.has(child.path)}
    <li>
      <button type="button" class="row" style:--depth={depth} aria-expanded={open} onclick={() => toggle(child.path)}>
        <span class="chevron" class:open aria-hidden="true">›</span>
        <span class="name">{child.name}</span>
      </button>
      {#if open}
        <ul role="group">{@render folder(child, depth + 1)}</ul>
      {/if}
    </li>
  {/each}
  {#each node.files as file (file.path)}
    {@const view = viewHref(vaultId, file.path)}
    <li>
      {#if view !== undefined}
        <a class="row note" style:--depth={depth} href={view} aria-current={file.path === current ? "page" : undefined}>
          <span class="name">{file.kind === "note" ? file.name.replace(/\.md$/i, "") : file.name}</span>
        </a>
      {:else}
        <a class="row file" style:--depth={depth} href={vaultFileHref(vaultId, file.path)} target="_blank" rel="noopener">
          <span class="name">{file.name}</span>
        </a>
      {/if}
    </li>
  {/each}
{/snippet}

<ul class="tree" bind:this={list}>{@render folder(root, 0)}</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    min-height: 28px;
    padding: 3px 8px 3px calc(8px + var(--depth) * 14px);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    font-size: 13px;
    line-height: 1.3;
    text-align: left;
    color: var(--ink-2);
    text-decoration: none;
    cursor: pointer;
  }
  .row:hover {
    background: var(--sunken);
    color: var(--ink);
  }
  .note {
    padding-left: calc(22px + var(--depth) * 14px);
  }
  .file {
    padding-left: calc(22px + var(--depth) * 14px);
    color: var(--ink-3);
  }
  .row[aria-current="page"] {
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-weight: 500;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    flex: 0 0 10px;
    color: var(--ink-3);
    transition: transform 100ms ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  /* Bigger touch targets on phones. */
  @media (max-width: 899px) {
    .row {
      min-height: 40px;
      font-size: 15px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
