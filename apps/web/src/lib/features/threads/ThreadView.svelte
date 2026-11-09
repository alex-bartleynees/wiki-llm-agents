<script lang="ts">
  import { tick } from "svelte";
  import AgentText from "./AgentText.svelte";
  import Composer from "./Composer.svelte";
  import RequestCard from "./RequestCard.svelte";
  import { openThread } from "./open-thread.svelte.ts";
  import { STATUS_LABEL } from "./status.ts";
  import { threads } from "./threads.svelte.ts";
  import { pendingRequests, type TimelineItem, usageLabel } from "./timeline.ts";

  const timeline = $derived(openThread.timeline);
  const status = $derived(pendingRequests(timeline).length > 0 ? "waiting" : timeline.runningTurn !== null ? "running" : "idle");

  let scroller = $state<HTMLElement>();
  /** Follow new content while the reader is at the end; leave them be once they scroll up. */
  let following = true;

  $effect(() => {
    void openThread.version;
    const element = scroller;
    if (element === undefined || !following) return;
    void tick().then(() => element.scrollTo({ top: element.scrollHeight }));
  });

  const onscroll = () => {
    const element = scroller;
    if (element) following = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  };

  const OUTCOME_LABEL = { completed: "Done", interrupted: "Stopped", failed: "Failed" } as const;

  /** "Done · 12.5K in · 187 out · $0.026", "Failed · <reason>" */
  const turnEndLabel = (item: Extract<TimelineItem, { kind: "turn-end" }>) =>
    [OUTCOME_LABEL[item.outcome], ...(item.usage ? [usageLabel(item.usage)] : []), ...(item.reason ? [item.reason] : [])].join(" · ");
</script>

<header>
  <button type="button" class="back" aria-label="All threads" onclick={() => threads.select(null)}>←</button>
  <h2 title={openThread.thread?.title ?? undefined}>{openThread.thread?.title ?? "New thread"}</h2>
  {#if status !== "idle"}
    <span class="status mono" data-status={status}>{STATUS_LABEL[status]}</span>
  {/if}
</header>

<div class="timeline" bind:this={scroller} {onscroll} aria-live="polite" aria-busy={status === "running"}>
  {#if openThread.status === "loading"}
    <p class="muted">Loading…</p>
  {:else if openThread.status === "failed"}
    <p class="error" role="alert">{openThread.error}</p>
  {:else if timeline.items.length === 0}
    <div class="muted intro">
      <p>Ask about the vault. This thread uses the replay provider, which plays recorded turns.</p>
      <p>Include <em>edit</em> for an approval, <em>question</em> for a question, <em>long</em> for a slow answer, or <em>fail</em> for an error.</p>
    </div>
  {/if}

  {#each timeline.items as item (item.kind + item.key)}
    {#if item.kind === "user"}
      <p class="user">{item.text}</p>
    {:else if item.kind === "agent"}
      <div class="agent"><AgentText text={item.text} /></div>
    {:else if item.kind === "tool"}
      <details class="tool" data-status={item.status}>
        <summary class="mono">
          <span class="icon" aria-hidden="true">{item.status === "running" ? "◌" : item.status === "failed" ? "✕" : "✓"}</span>
          <span class="name">{item.name}</span>
          <span class="input">{item.input}</span>
        </summary>
        <pre class="mono">{item.output || (item.status === "running" ? "Running…" : "No output")}</pre>
      </details>
    {:else if item.kind === "request"}
      <RequestCard request={item} />
    {:else}
      <p class="turn-end mono" data-outcome={item.outcome}>{turnEndLabel(item)}</p>
    {/if}
  {/each}

  {#if status === "running"}
    <p class="working mono" aria-label="The agent is working">●●●</p>
  {/if}
</div>

{#if openThread.error && openThread.status === "loaded"}
  <p class="error action-error" role="alert">{openThread.error}</p>
{/if}

<Composer />

<style>
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line-soft);
  }
  .back {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  h2 {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--accent-ink);
  }
  .status[data-status="waiting"] {
    color: var(--agent);
    font-weight: 500;
  }
  .timeline {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 12px;
  }
  .timeline > p {
    margin: 0;
  }
  .user {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .user {
    align-self: flex-end;
    max-width: 85%;
    padding: 8px 12px;
    border-radius: 10px 10px 2px 10px;
    background: var(--accent-soft);
  }
  /* Amber marks what an agent wrote. */
  .agent {
    overflow-wrap: anywhere;
    padding-left: 10px;
    border-left: 2px solid var(--agent);
    font-family: var(--font-read);
    font-size: 15px;
    line-height: 1.55;
  }
  .tool {
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 12px;
  }
  .tool summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    color: var(--ink-2);
    cursor: pointer;
    list-style: none;
  }
  .tool summary::-webkit-details-marker {
    display: none;
  }
  .icon {
    flex: 0 0 auto;
    color: var(--ok);
  }
  .tool[data-status="running"] .icon {
    color: var(--accent-ink);
  }
  .tool[data-status="failed"] .icon {
    color: var(--del);
  }
  .name {
    flex: 0 0 auto;
    font-weight: 500;
    color: var(--ink);
  }
  .input {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-3);
  }
  .tool pre {
    margin: 0;
    padding: 6px 8px 8px;
    border-top: 1px solid var(--line-soft);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .turn-end {
    align-self: center;
    font-size: 11px;
    color: var(--ink-3);
  }
  .turn-end[data-outcome="failed"] {
    color: var(--del);
  }
  .working {
    color: var(--agent);
    font-size: 11px;
    letter-spacing: 2px;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .working {
      animation: none;
    }
  }
  .muted {
    color: var(--ink-3);
  }
  .intro p {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .error {
    color: var(--del);
  }
  .action-error {
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 12px;
    font-size: 12px;
  }
</style>
