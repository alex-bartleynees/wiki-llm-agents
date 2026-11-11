<script lang="ts">
  import type { GetChangeResponse } from "@wiki-agents/contracts/changes/get-change/response";

  /**
   * The three versions of a changed file side by side (stacked on a phone): before
   * the turn, as the turn left it, and on disk now.
   */
  let { change }: { change: GetChangeResponse } = $props();

  const versions = $derived([
    { label: "Before the turn", text: change.before, missing: "No file (the turn created it)" },
    { label: "As the turn left it", text: change.after, missing: "No file (the turn deleted it)" },
    { label: "Now", text: change.current, missing: "No file" },
  ]);
</script>

<div class="versions" role="group" aria-label={`Versions of ${change.path}`}>
  {#each versions as version (version.label)}
    <section aria-label={version.label}>
      <h4 class="mono">{version.label}</h4>
      {#if version.text === null}
        <p class="missing">{version.missing}</p>
      {:else}
        <pre class="mono">{version.text}</pre>
      {/if}
    </section>
  {/each}
</div>

<style>
  .versions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-top: 8px;
  }
  /* The chat pane is narrow on desktop too: stack unless there is room. */
  @container changes (max-width: 640px) {
    .versions {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  h4 {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  pre {
    margin: 0;
    padding: 8px;
    max-height: 280px;
    overflow: auto;
    border-radius: var(--radius);
    background: var(--sunken);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .missing {
    margin: 0;
    font-size: 12px;
    color: var(--ink-3);
  }
</style>
