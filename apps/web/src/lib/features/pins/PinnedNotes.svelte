<script lang="ts">
  import { viewHref } from "@wiki-agents/contracts/notes/model";
  import { pins } from "./pins.svelte.ts";

  let { vaultId, current }: { vaultId: string; current: string | undefined } = $props();
</script>

{#if pins.vaultId === vaultId && pins.pins.length > 0}
  <section aria-labelledby="pinned-heading">
    <h3 id="pinned-heading" class="mono">Pinned</h3>
    <ul>
      {#each pins.pins as pin (pin.path)}
        {@const href = viewHref(vaultId, pin.path)}
        <li>
          {#if pin.title !== null && href !== undefined}
            <a {href} aria-current={pin.path === current ? "page" : undefined} title={pin.path}>
              <span aria-hidden="true" class="mark">★</span>{pin.title}
            </a>
          {:else}
            <span class="missing" title="{pin.path} is no longer in the vault">
              <span aria-hidden="true" class="mark">☆</span>{pin.path.split("/").at(-1)}
            </span>
            <button type="button" aria-label="Unpin {pin.path}" title="Unpin" onclick={() => pins.toggle(vaultId, pin.path)}>×</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  section {
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line-soft);
  }
  h3 {
    margin: 0 0 4px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
  }
  a,
  .missing {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: var(--radius);
    color: var(--ink-2);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a:hover {
    background: var(--sunken);
    color: var(--ink);
  }
  a[aria-current="page"] {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  .mark {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--accent-ink);
  }
  .missing {
    color: var(--ink-3);
    text-decoration: line-through;
  }
  button {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
  }
  button:hover {
    background: var(--sunken);
    color: var(--ink);
  }
  @media (max-width: 899px) {
    a,
    .missing {
      min-height: 40px;
    }
    button {
      width: 40px;
      height: 40px;
    }
  }
</style>
