<script lang="ts">
  import { ResolveLinksRequest } from "@wiki-agents/contracts/notes/resolve-links/request";
  import { ResolveLinksResponse } from "@wiki-agents/contracts/notes/resolve-links/response";
  import { postJson } from "#lib/api/client.ts";
  import { openThread } from "./open-thread.svelte.ts";
  import { type Inline, parseAgentText } from "./agent-text.ts";

  /** `vaultId` resolves citations; the open thread's vault by default. */
  let { text, vaultId: inVault }: { text: string; vaultId?: string | null } = $props();
  const blocks = $derived(parseAgentText(text));
  const citations = $derived([...new Set(blocks.flatMap((block) => block.type === "p" ? block.lines.flat() : block.items.flat()).filter((part) => part.type === "citation").map((part) => part.text))].slice(0, 100));
  let resolved = $state<Record<string, string | null>>({});
  $effect(() => {
    const vaultId = inVault ?? openThread.thread?.vaultId;
    const links = citations.map((link) => ({ link }));
    let active = true;
    if (vaultId && links.length) void postJson(`/api/vaults/${vaultId}/resolve-links`, ResolveLinksRequest, { links }, ResolveLinksResponse).then((response) => {
      if (active) resolved = Object.fromEntries(response.links.map((link, index) => [links[index]!.link, link.href]));
    }, () => { if (active) resolved = {}; });
    return () => { active = false; };
  });
</script>

{#snippet inline(parts: ReadonlyArray<Inline>)}
  {#each parts as part, index (index)}
    {#if part.type === "citation"}{#if resolved[part.text]}<a href={resolved[part.text]!} title={part.text}>[{citations.indexOf(part.text) + 1}]</a>{:else}<span title="Unresolved citation">[[{part.text}]]</span>{/if}{:else if part.type === "strong"}<strong>{part.text}</strong>{:else if part.type === "em"}<em>{part.text}</em>{:else if part.type === "code"}<code
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
