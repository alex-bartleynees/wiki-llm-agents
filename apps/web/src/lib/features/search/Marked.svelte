<script lang="ts">
  import type { SnippetPart } from "@wiki-agents/contracts/search/model";

  /** Text from a note: drawn as text only, never as HTML. */
  let { parts }: { parts: ReadonlyArray<SnippetPart> } = $props();
</script>

{#each parts as part, index (index)}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}

<style>
  mark {
    padding: 0 1px;
    border-radius: 2px;
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-weight: 600;
  }
</style>
