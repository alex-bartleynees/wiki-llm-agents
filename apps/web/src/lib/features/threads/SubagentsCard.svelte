<script lang="ts">
  import { isSubagentActive, type SubagentStatus } from "@wiki-agents/contracts/threads/model";
  import AgentText from "./AgentText.svelte";
  import type { Subagent } from "./timeline.ts";

  /**
   * The subagents a turn launched (the agent's own delegation, run in the background
   * by the provider): each one's status and latest report. Collapsible; the summary
   * says how many are still at work.
   */
  let { subagents }: { subagents: ReadonlyArray<Subagent> } = $props();

  const working = $derived(subagents.filter((subagent) => isSubagentActive(subagent.status)).length);
  const summary = $derived.by(() => {
    const counts = new Map<SubagentStatus, number>();
    for (const subagent of subagents) counts.set(subagent.status, (counts.get(subagent.status) ?? 0) + 1);
    return [...counts].map(([status, count]) => `${count} ${LABEL[status].toLowerCase()}`).join(", ");
  });

  const ICON: Record<SubagentStatus, string> = { running: "◌", waiting: "?", done: "✓", failed: "✕", cancelled: "–", interrupted: "!" };
  const LABEL: Record<SubagentStatus, string> = {
    running: "Running",
    waiting: "Waiting for you",
    done: "Done",
    failed: "Failed",
    cancelled: "Stopped",
    interrupted: "Cut off",
  };
  const TITLE: Partial<Record<SubagentStatus, string>> = {
    interrupted: "The server or the provider stopped while it was working; what it had done is unknown.",
  };
</script>

<details class="subagents" open>
  <summary class="mono">
    <span>{subagents.length === 1 ? "Subagent" : `${subagents.length} subagents`}</span>
    <span class="count" role="status">{summary}</span>
  </summary>
  <ul>
    {#each subagents as subagent (subagent.id)}
      <li data-status={subagent.status} data-live={working > 0 && subagent.status === "running" ? "" : undefined}>
        <div class="head">
          <span class="icon mono" aria-hidden="true">{ICON[subagent.status]}</span>
          <span class="label">{subagent.label}</span>
          {#if subagent.agent}<span class="agent mono">{subagent.agent}</span>{/if}
          <span class="status mono" title={TITLE[subagent.status]}>{LABEL[subagent.status]}</span>
        </div>
        {#if subagent.result}
          <details class="result">
            <summary class="mono">Latest report</summary>
            <AgentText text={subagent.result} />
          </details>
        {/if}
      </li>
    {/each}
  </ul>
</details>

<style>
  .subagents {
    border: 1px solid var(--line-soft);
    border-left: 3px solid var(--agent);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 8px 12px;
    font-size: 13px;
  }
  .subagents > summary {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--ink-3);
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
    min-width: 0;
  }
  .icon {
    flex: none;
    width: 1em;
    text-align: center;
  }
  .label {
    color: var(--ink);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .agent,
  .status {
    font-size: 11px;
    color: var(--ink-3);
  }
  .status {
    margin-left: auto;
  }
  li[data-status="running"] .icon,
  li[data-status="waiting"] .icon {
    color: var(--agent);
  }
  li[data-status="waiting"] .status {
    color: var(--agent);
    font-weight: 600;
  }
  li[data-status="done"] .icon {
    color: var(--ok);
  }
  li[data-status="failed"] .icon,
  li[data-status="interrupted"] .icon {
    color: var(--warn);
  }
  li[data-live] .icon {
    animation: pulse 1.4s ease-in-out infinite;
  }
  .result {
    margin: 4px 0 0 calc(1em + 8px);
    color: var(--ink-2);
  }
  .result summary {
    font-size: 11px;
    color: var(--ink-3);
    cursor: pointer;
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
