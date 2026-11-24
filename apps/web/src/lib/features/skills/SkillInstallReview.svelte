<script lang="ts">
  import type { InstallAction, Review } from "@wiki-agents/contracts/skills/model";
  import TextDiff from "#lib/features/agents/TextDiff.svelte";
  import { showLineDiff } from "./line-diff.ts";
  import Card from "#lib/ui/primitives/Card.svelte";
  import Button from "#lib/ui/primitives/Button.svelte";

  let { review, disabled, confirm, cancel }: {
    review: { readonly action: InstallAction; readonly diff: Review };
    disabled: boolean;
    confirm: () => void;
    cancel: () => void;
  } = $props();
</script>

<div class="install-review">
  <Card size="medium" aria-label="Install review">
    <div class="review">
      <h3>Review {review.action}</h3>
      <code class="mono">{review.diff.path}</code>
      {#if showLineDiff(review.diff.before, review.diff.after)}
        <TextDiff before={review.diff.before} after={review.diff.after} label="SKILL.md changes" />
      {:else}
        <details><summary>Current SKILL.md</summary><pre class="mono">{review.diff.before}</pre></details>
        <details><summary>Proposed SKILL.md</summary><pre class="mono">{review.diff.after}</pre></details>
      {/if}
      <ul>
        {#each review.diff.files as file}
          <li>{file.kind} <code class="mono">{file.path}</code></li>
        {/each}
      </ul>
      <div class="buttons">
        <Button variant="primary" size="large" {disabled} onclick={confirm}>Confirm {review.action}</Button>
        <Button size="large" onclick={cancel}>Cancel review</Button>
      </div>
    </div>
  </Card>
</div>

<style>
  .install-review {
    grid-column: 1 / -1;
    min-width: 0;
  }

  .review {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  code {
    overflow-wrap: anywhere;
  }

  ul {
    margin: 0;
    padding-left: 18px;
  }

  pre {
    max-height: 61vh;
    margin: 0;
    padding: 12px;
    overflow: auto;
    background: var(--sunken);
    color: var(--ink-2);
    font-size: 13px;
    line-height: 1.62;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
