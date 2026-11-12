<script lang="ts">
  import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";

  let { receipt }: { receipt: Extract<ThreadEvent, { readonly _tag: "schedule.saved" }> } = $props();

  const ACTIONS = {
    created: "Scheduled",
    updated: "Schedule changed",
    paused: "Schedule paused",
    resumed: "Schedule resumed",
    deleted: "Schedule deleted",
    run: "Schedule run now",
  } as const;
</script>

<!-- What the agent scheduled, so you can check the time it understood. -->
<section class="receipt" aria-label="{ACTIONS[receipt.action]}: {receipt.title}">
  <header>
    <span class="action mono">{ACTIONS[receipt.action]}</span>
    <span class="kind">{receipt.kind === "prompt" ? "Scheduled prompt" : "Reminder"}</span>
  </header>
  <p class="title">{receipt.title}</p>
  <dl>
    <dt>When</dt>
    <dd>{receipt.recurrence}</dd>
    <dt>Next</dt>
    <dd>{receipt.next ?? "Won't fire again"}</dd>
    <dt>Timezone</dt>
    <dd>{receipt.timezone}</dd>
    {#if receipt.agent !== null}
      <dt>Agent</dt>
      <dd>{receipt.agent}</dd>
    {/if}
    <dt>{receipt.kind === "prompt" ? "Prompt" : "Message"}</dt>
    <dd class="text">{receipt.text}</dd>
    <dt>Arrives in</dt>
    <dd>{receipt.destination}</dd>
  </dl>
  {#if receipt.action !== "deleted"}
    <a class="edit" href={receipt.href}>Edit schedule</a>
  {/if}
</section>

<style>
  .receipt {
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 13px;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--ink-3);
    font-size: 11px;
  }
  .action {
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .title {
    margin: 4px 0 6px;
    font-weight: 600;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 10px;
    margin: 0 0 8px;
  }
  dt {
    color: var(--ink-3);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .text {
    white-space: pre-wrap;
  }
</style>
