<script lang="ts">
  import type { InstallAction, Review } from "@wiki-agents/contracts/skills/model";
  import TextDiff from "#lib/features/agents/TextDiff.svelte";
  import { showLineDiff } from "./line-diff.ts";

  let { review, disabled, confirm, cancel }: {
    review: { readonly action: InstallAction; readonly diff: Review };
    disabled: boolean;
    confirm: () => void;
    cancel: () => void;
  } = $props();
</script>

<section class="card install-review" aria-label="Install review">
  <h3>Review {review.action}</h3>
  <code>{review.diff.path}</code>
  {#if showLineDiff(review.diff.before, review.diff.after)}
    <TextDiff before={review.diff.before} after={review.diff.after} label="SKILL.md changes" />
  {:else}
    <details><summary>Current SKILL.md</summary><pre>{review.diff.before}</pre></details>
    <details><summary>Proposed SKILL.md</summary><pre>{review.diff.after}</pre></details>
  {/if}
  <ul>
    {#each review.diff.files as file}
      <li>{file.kind} <code>{file.path}</code></li>
    {/each}
  </ul>
  <div class="buttons">
    <button class="primary" {disabled} onclick={confirm}>Confirm {review.action}</button>
    <button onclick={cancel}>Cancel review</button>
  </div>
</section>
