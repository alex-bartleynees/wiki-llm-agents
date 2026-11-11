<script lang="ts">
  import { diffLines } from "./diff-lines.ts";

  /** A unified diff, coloured by line. Text only: file content never becomes markup. */
  let { diff, label = "Diff" }: { diff: string; label?: string } = $props();
  const lines = $derived(diffLines(diff));
</script>

<pre class="mono" aria-label={label}>{#each lines as { line, kind }, index (index)}<span data-kind={kind}>{line}</span>{"\n"}{/each}</pre>

<style>
  pre {
    margin: 0;
    padding: 8px;
    max-height: 360px;
    overflow: auto;
    border-radius: var(--radius);
    background: var(--sunken);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  [data-kind="ins"] {
    color: var(--ins);
  }
  [data-kind="del"] {
    color: var(--del);
  }
  [data-kind="hunk"] {
    color: var(--ink-3);
  }
</style>
