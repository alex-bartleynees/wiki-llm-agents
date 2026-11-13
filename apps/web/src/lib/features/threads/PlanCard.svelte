<script lang="ts">
  import { type PlanStep, planProgress } from "@wiki-agents/contracts/threads/model";

  /** The agent's plan for a turn: each step, ticked off as it reports progress. */
  let { steps, live }: { steps: ReadonlyArray<PlanStep>; live: boolean } = $props();

  const progress = $derived(planProgress(steps));
  const ICON = { pending: "○", in_progress: "◐", completed: "✓", cancelled: "–" } as const;
  const LABEL = { pending: "To do", in_progress: "In progress", completed: "Done", cancelled: "Cancelled" } as const;
</script>

<section class="plan" aria-label="Plan">
  <header class="mono">
    <span>Plan</span>
    <span class="count">{progress.done} of {progress.total} done</span>
  </header>
  <ol>
    {#each steps as step, index (index)}
      <li data-status={step.status} data-live={live && step.status === "in_progress" ? "" : undefined}>
        <span class="icon mono" aria-hidden="true">{ICON[step.status]}</span>
        <span class="visually-hidden">{LABEL[step.status]}:</span>
        <span class="text">{step.text}</span>
      </li>
    {/each}
  </ol>
</section>

<style>
  .plan {
    border: 1px solid var(--line-soft);
    border-left: 3px solid var(--agent);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 8px 12px;
    font-size: 13px;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 11px;
    color: var(--ink-3);
    margin-bottom: 6px;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    color: var(--ink-2);
  }
  .icon {
    flex: none;
    width: 1em;
    text-align: center;
  }
  li[data-status="in_progress"] {
    color: var(--ink);
    font-weight: 600;
  }
  li[data-status="in_progress"] .icon {
    color: var(--agent);
  }
  li[data-live] .icon {
    animation: pulse 1.4s ease-in-out infinite;
  }
  li[data-status="completed"] .icon {
    color: var(--ok);
  }
  li[data-status="cancelled"] .text {
    text-decoration: line-through;
    color: var(--ink-3);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    li[data-live] .icon {
      animation: none;
    }
  }
</style>
