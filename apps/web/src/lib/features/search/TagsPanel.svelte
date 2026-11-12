<script lang="ts">
  import { untrack } from "svelte";
  import { vaultEvents } from "#lib/features/indexing/vault-events.svelte.ts";
  import { search } from "./search.svelte.ts";
  import { tagTree, type TagNode } from "./tag-tree.ts";

  let { vaultId }: { vaultId: string } = $props();

  let filter = $state("");
  /** Tags whose nested tags are folded away. */
  let folded = $state<ReadonlySet<string>>(new Set());

  $effect(() => {
    search.useVault(vaultId);
  });
  // Tags come and go as notes change.
  $effect(() => {
    void search.vaultId;
    void vaultEvents.revision;
    untrack(() => void search.loadTags());
  });

  const nodes = $derived(tagTree(search.tagList ?? [], filter));
  const filtering = $derived(filter.trim() !== "");

  const toggle = (tag: string) => {
    const next = new Set(folded);
    if (!next.delete(tag)) next.add(tag);
    folded = next;
  };
  const notes = (count: number) => `${count} ${count === 1 ? "note" : "notes"}`;
</script>

{#snippet branch(list: ReadonlyArray<TagNode>, depth: number)}
  <ul class:nested={depth > 0} aria-label={depth === 0 ? "Tags" : undefined}>
    {#each list as node (node.tag)}
      {@const open = filtering || !folded.has(node.tag)}
      <li>
        <div class="row" style:padding-left="{depth * 14}px">
          {#if node.children.length > 0}
            <button type="button" class="fold" aria-expanded={open} aria-label="Tags under #{node.tag}" onclick={() => toggle(node.tag)}>
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            </button>
          {:else}
            <span class="fold" aria-hidden="true"></span>
          {/if}
          <button
            type="button"
            class="tag"
            title="Notes tagged #{node.tag}{node.children.length > 0 ? ' or a tag under it' : ''}"
            onclick={() => search.showTag(node.tag)}
          >
            <span class="name">#{depth === 0 ? node.tag : node.name}</span>
            <span class="count mono" aria-label={notes(node.total)}>{node.total}</span>
          </button>
        </div>
        {#if node.children.length > 0 && open}
          {@render branch(node.children, depth + 1)}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="tags">
  <label class="visually-hidden" for="tag-filter">Filter tags</label>
  <input id="tag-filter" type="search" placeholder="Filter tags" bind:value={filter} autocomplete="off" autocapitalize="off" spellcheck="false" />
  {#if search.tagList === undefined}
    <p class="muted">Loading…</p>
  {:else if search.tagList.length === 0}
    <p class="muted">No tags yet. Tags come from <span class="mono">tags:</span> in a note's frontmatter.</p>
  {:else if nodes.length === 0}
    <p class="muted">No tag matches “{filter.trim()}”.</p>
  {:else}
    {@render branch(nodes, 0)}
  {/if}
</div>

<style>
  .tags {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: 8px;
  }
  input {
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    color: var(--ink);
  }
  .muted {
    margin: 0;
    padding: 0 2px;
    font-size: 13px;
    color: var(--ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
  }
  .fold {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 20px;
    height: 28px;
    padding: 0;
    border: 0;
    background: transparent;
    font-size: 10px;
    color: var(--ink-3);
    cursor: pointer;
  }
  .tag {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px 0 4px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    font-size: 13px;
    text-align: left;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .tag:hover {
    background: var(--sunken);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 11px;
    color: var(--ink-3);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  @media (max-width: 899px) {
    input {
      height: 40px;
      font-size: 16px;
    }
    .fold,
    .tag {
      height: 38px;
    }
    .fold {
      width: 28px;
    }
  }
</style>
