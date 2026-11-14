<script lang="ts">
  import { diffLines } from "./diff-lines.ts";
  import { diffSyntaxColours } from "./diff-syntax.svelte.ts";

  /**
   * A unified diff: added and removed lines tinted, and coloured by syntax when `path`
   * names a known language. Text only: file content never becomes markup.
   */
  let { diff, label = "Diff", path = null }: { diff: string; label?: string; path?: string | null } = $props();
  const lines = $derived(diffLines(diff));

  let element = $state<HTMLElement>();
  diffSyntaxColours(() => ({ path, diff, lines, root: element, open: true, offset: 0 }));
</script>

<pre class="mono" aria-label={label} bind:this={element}>{#each lines as { line, kind }, index (index)}{#if kind === "hunk"}<span class="line" data-kind={kind}>{line}{"\n"}</span>{:else}<span class="line" data-kind={kind}><span class="sign">{line[0]}</span><span data-line={index}>{line.slice(1)}</span>{"\n"}</span>{/if}{/each}</pre>

<style>
  pre {
    margin: 0;
    padding: 8px 0;
    max-height: 360px;
    overflow: auto;
    border-radius: var(--radius);
    background: var(--sunken);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .line {
    display: block;
    padding: 0 8px;
  }
  [data-kind="ins"] {
    background: color-mix(in srgb, var(--ins) 10%, transparent);
  }
  [data-kind="del"] {
    background: color-mix(in srgb, var(--del) 10%, transparent);
  }
  [data-kind="hunk"] {
    color: var(--ink-3);
  }
  [data-kind="ins"] .sign {
    color: var(--ins);
  }
  [data-kind="del"] .sign {
    color: var(--del);
  }
</style>
