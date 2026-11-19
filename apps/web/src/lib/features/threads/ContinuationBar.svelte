<script lang="ts">
  import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
  import { threads } from "./threads.svelte.ts";

  /**
   * Links between a thread and the one it continues (Continue in a new thread), under
   * the header: "Continues …" on the new thread, "Continued in …" on the old one.
   * Nothing for a thread that is neither.
   */
  let { thread }: { thread: ThreadSummary } = $props();

  const titleOf = (threadId: string, fallback: string) => threads.threads.find((each) => each.id === threadId)?.title ?? fallback;
</script>

{#if thread.continuedFrom !== null || thread.continuedIn !== null}
  <nav class="continuation" aria-label="Continuation">
    {#if thread.continuedFrom !== null}
      {@const from = thread.continuedFrom}
      <span>Continues <button type="button" class="link" onclick={() => threads.select(from)}>{titleOf(from, "an earlier thread")}</button></span>
    {/if}
    {#if thread.continuedIn !== null}
      {@const next = thread.continuedIn}
      <span>Continued in <button type="button" class="link" onclick={() => threads.select(next)}>{titleOf(next, "a newer thread")}</button></span>
    {/if}
  </nav>
{/if}

<style>
  .continuation {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface);
    color: var(--ink-3);
    font-size: 12px;
  }
  span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  @media (max-width: 899px) {
    .link {
      min-height: 32px;
    }
  }
</style>
