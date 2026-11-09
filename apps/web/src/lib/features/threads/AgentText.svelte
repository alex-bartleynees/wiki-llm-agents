<script lang="ts">
  import { type Inline, parseAgentText } from "./agent-text.ts";

  let { text }: { text: string } = $props();
  const blocks = $derived(parseAgentText(text));
</script>

{#snippet inline(parts: ReadonlyArray<Inline>)}
  {#each parts as part, index (index)}
    {#if part.type === "strong"}<strong>{part.text}</strong>{:else if part.type === "em"}<em>{part.text}</em>{:else if part.type === "code"}<code
        class="mono">{part.text}</code
      >{:else}{part.text}{/if}
  {/each}
{/snippet}

{#each blocks as block, index (index)}
  {#if block.type === "ul"}
    <ul>
      {#each block.items as item, itemIndex (itemIndex)}
        <li>{@render inline(item)}</li>
      {/each}
    </ul>
  {:else}
    <p>
      {#each block.lines as line, lineIndex (lineIndex)}
        {#if lineIndex > 0}<br />{/if}{@render inline(line)}
      {/each}
    </p>
  {/if}
{/each}

<style>
  p,
  ul {
    margin: 0 0 0.6em;
  }
  p:last-child,
  ul:last-child {
    margin-bottom: 0;
  }
  ul {
    padding-left: 1.2em;
  }
  code {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--sunken);
    font-size: 0.85em;
  }
</style>
