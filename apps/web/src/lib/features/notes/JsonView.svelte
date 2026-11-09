<script lang="ts">
  import { vaultFileHref } from "@wiki-agents/contracts/notes/model";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { errorMessage, isAbort } from "#lib/api/client.ts";
  import {
    containersTo,
    entriesOf,
    isContainer,
    isWebUrl,
    type Json,
    nodeId,
    type ParsedJson,
    parseJson,
    summaryOf,
  } from "./json-view.ts";

  let { vaultId, path }: { vaultId: string; path: string } = $props();

  /** Bigger files are offered raw rather than drawn as a tree. */
  const MAX_BYTES = 5_000_000;
  /** Children shown per object or array before "Show more". */
  const PAGE = 100;

  type ViewState =
    | { readonly status: "loading" }
    | { readonly status: "loaded"; readonly text: string; readonly parsed: ParsedJson }
    | { readonly status: "too-large"; readonly bytes: number }
    | { readonly status: "failed"; readonly message: string };

  const src = $derived(vaultFileHref(vaultId, path));
  const name = $derived(path.split("/").at(-1) ?? path);
  let viewState = $state<ViewState>({ status: "loading" });
  let mode = $state<"tree" | "raw">("tree");
  const expanded = new SvelteSet<string>();
  const shown = new SvelteMap<string, number>();

  $effect(() => {
    const controller = new AbortController();
    viewState = { status: "loading" };
    expanded.clear();
    shown.clear();
    (async () => {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) throw new Error((await response.text()) || response.statusText);
      const bytes = Number(response.headers.get("content-length") ?? 0);
      if (bytes > MAX_BYTES) {
        viewState = { status: "too-large", bytes };
        controller.abort();
        return;
      }
      const text = await response.text();
      const parsed = parseJson(text);
      if (parsed.ok) for (const id of containersTo(parsed.value, 1)) expanded.add(id);
      viewState = { status: "loaded", text, parsed };
    })().catch((error: unknown) => {
      if (!isAbort(error)) viewState = { status: "failed", message: errorMessage(error, "Could not load the file") };
    });
    return () => controller.abort();
  });

  const toggle = (id: string) => (expanded.has(id) ? expanded.delete(id) : expanded.add(id));

  const expandAll = (value: Json) => {
    for (const id of containersTo(value, Number.POSITIVE_INFINITY).slice(0, 5000)) expanded.add(id);
  };
</script>

<svelte:head>
  <title>{name} · wiki-agents</title>
</svelte:head>

{#snippet scalar(value: Json)}
  {#if typeof value === "string"}
    {#if isWebUrl(value)}
      <a class="string" href={value} target="_blank" rel="noopener noreferrer">"{value}"</a>
    {:else}
      <span class="string">"{value}"</span>
    {/if}
  {:else if typeof value === "number"}
    <span class="number">{value}</span>
  {:else}
    <span class="literal">{String(value)}</span>
  {/if}
{/snippet}

{#snippet node(key: string | undefined, value: Json, keyPath: ReadonlyArray<string>, inArray: boolean)}
  {#if isContainer(value)}
    {@const id = nodeId(keyPath)}
    {@const open = expanded.has(id)}
    {@const entries = entriesOf(value)}
    {@const limit = shown.get(id) ?? PAGE}
    <li>
      <button type="button" class="row" aria-expanded={open} onclick={() => toggle(id)}>
        <span class="chevron" class:open aria-hidden="true">›</span>
        {#if key !== undefined}<span class="key" class:index={inArray}>{key}</span><span class="colon">:</span>{/if}
        <span class="summary">{summaryOf(value)}</span>
      </button>
      {#if open && entries.length > 0}
        <ul role="group">
          {#each entries.slice(0, limit) as [childKey, child] (childKey)}
            {@render node(childKey, child, [...keyPath, childKey], Array.isArray(value))}
          {/each}
          {#if entries.length > limit}
            <li>
              <button type="button" class="more" onclick={() => shown.set(id, limit + PAGE)}>
                Show {Math.min(PAGE, entries.length - limit)} more of {entries.length - limit}
              </button>
            </li>
          {/if}
        </ul>
      {/if}
    </li>
  {:else}
    <li class="leaf">
      {#if key !== undefined}<span class="key" class:index={inArray}>{key}</span><span class="colon">:</span>{/if}
      {@render scalar(value)}
    </li>
  {/if}
{/snippet}

<div class="json">
  <div class="bar mono">
    <span class="path">{path}</span>
    {#if viewState.status === "loaded" && viewState.parsed.ok}
      {@const value = viewState.parsed.value}
      <div class="modes" role="group" aria-label="View">
        <button type="button" aria-pressed={mode === "tree"} onclick={() => (mode = "tree")}>Tree</button>
        <button type="button" aria-pressed={mode === "raw"} onclick={() => (mode = "raw")}>Raw</button>
      </div>
      {#if mode === "tree" && isContainer(value)}
        <button type="button" onclick={() => expandAll(value)}>Expand all</button>
        <button type="button" onclick={() => expanded.clear()}>Collapse</button>
      {/if}
    {/if}
    <a href={src} target="_blank" rel="noopener noreferrer">Raw file ↗</a>
  </div>

  <div class="body">
    {#if viewState.status === "loading"}
      <p class="muted">Loading…</p>
    {:else if viewState.status === "failed"}
      <p class="muted">{viewState.message}</p>
    {:else if viewState.status === "too-large"}
      <p class="muted">
        This file is {(viewState.bytes / 1_000_000).toFixed(1)} MB, too large to show as a tree.
        <a href={src} target="_blank" rel="noopener noreferrer">Open the raw file</a>.
      </p>
    {:else if !viewState.parsed.ok}
      <p class="error">Not valid JSON: {viewState.parsed.message}</p>
      <pre>{viewState.text}</pre>
    {:else}
      {#if viewState.parsed.decodedFromString}
        <p class="notice">This file holds JSON encoded as a string; it is shown decoded.</p>
      {/if}
      {#if mode === "raw"}
        <pre>{JSON.stringify(viewState.parsed.value, null, 2)}</pre>
      {:else if isContainer(viewState.parsed.value)}
        <ul class="tree mono">{@render node(undefined, viewState.parsed.value, [], false)}</ul>
      {:else}
        <p class="mono">{@render scalar(viewState.parsed.value)}</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .json {
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    font-size: 11px;
    color: var(--ink-3);
  }
  .path {
    flex: 1 1 200px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar button {
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    color: var(--ink-2);
    cursor: pointer;
  }
  .modes {
    display: flex;
  }
  .modes button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .modes button:last-child {
    margin-left: -1px;
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .modes button[aria-pressed="true"] {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  .body {
    padding: 16px;
    overflow-x: auto;
  }
  .muted {
    color: var(--ink-3);
  }
  .error {
    color: var(--del);
  }
  .notice {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    font-size: 13px;
  }
  pre {
    margin: 0;
    font: 13px/1.5 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 0 0 16px;
    font-size: 13px;
    line-height: 1.6;
  }
  .tree {
    padding-left: 0;
  }
  .row {
    display: inline-flex;
    align-items: baseline;
    padding: 0 4px 0 0;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--sunken);
  }
  /* Wrapped and multi-line values line up under the value, not under the key. */
  .leaf {
    display: flex;
    align-items: baseline;
    padding-left: 14px;
  }
  .leaf > .key,
  .leaf > .colon {
    flex: 0 0 auto;
  }
  .leaf > :last-child {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .chevron {
    display: inline-block;
    width: 10px;
    margin-right: 4px;
    color: var(--ink-3);
    transition: transform 100ms ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .key {
    color: var(--ink);
    font-weight: 500;
  }
  .key.index {
    color: var(--ink-3);
    font-weight: 400;
  }
  .colon {
    margin-right: 6px;
    color: var(--ink-3);
  }
  .summary {
    color: var(--ink-3);
  }
  .string {
    color: var(--ok);
  }
  .number {
    color: var(--accent-ink);
  }
  .literal {
    color: var(--del);
  }
  .more {
    margin: 2px 0 2px 14px;
    padding: 2px 8px;
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    color: var(--ink-2);
    cursor: pointer;
  }
  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
