<script lang="ts">
  import { textDiff } from "./text-diff.ts";

  /** `before` in red, `after` in green, line by line. */
  let { before, after, label }: { before: string; after: string; label: string } = $props();

  const lines = $derived(textDiff(before, after));
</script>

<pre class="diff" aria-label={label}>{#each lines as line, index (index)}<span class="line" data-kind={line.kind}><span class="sign" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>{line.text}
</span>{/each}</pre>

<style>
  .diff {
    margin: 0;
    max-height: 50vh;
    overflow: auto;
    padding: 6px 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    font: 12px/1.5 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .line {
    display: block;
    padding: 0 8px;
  }
  .sign {
    display: inline-block;
    width: 1.4em;
    color: var(--ink-3);
  }
  .line[data-kind="removed"] {
    background: color-mix(in srgb, var(--del) 14%, transparent);
  }
  .line[data-kind="added"] {
    background: color-mix(in srgb, var(--ins) 16%, transparent);
  }
</style>
