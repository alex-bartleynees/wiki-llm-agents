<script lang="ts">
  import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
  import { noteHref } from "@wiki-agents/contracts/notes/model";
  import { scheduleHref } from "@wiki-agents/contracts/schedules/model";
  import AgentText from "#lib/features/threads/AgentText.svelte";
  import { threadHref } from "#lib/features/threads/thread-link.ts";
  import { inbox } from "./inbox.svelte.ts";

  /** `fresh`: it was unread when the inbox opened, so it stays marked as new. */
  let { item, fresh = false }: { item: InboxItem; fresh?: boolean } = $props();

  const KINDS = {
    reminder: "Reminder",
    "prompt.result": "Scheduled prompt",
    "prompt.failed": "Scheduled prompt failed",
    "prompt.missed": "Scheduled prompt missed",
    request: "Waiting for you",
    "turn.finished": "Turn finished",
    "turn.failed": "Turn failed",
  } as const;

  const HOUR = 3_600_000;
  /**
   * Snooze times from the item's own time when that is later than this device's
   * clock, so they are always in the server's future.
   */
  const snoozeOptions = $derived.by(() => {
    const now = Math.max(Date.now(), item.updatedAt);
    const morning = new Date(now + 24 * HOUR);
    morning.setHours(9, 0, 0, 0);
    return [
      { label: "1 hour", until: now + HOUR },
      { label: "3 hours", until: now + 3 * HOUR },
      { label: "Tomorrow 9:00", until: morning.getTime() },
    ];
  });

  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const failedDeliveries = $derived(item.deliveries.filter((delivery) => delivery.status === "failed"));
  const open = $derived(item.state === "open");
  const { vaultId, threadId, notePath, scheduleId } = $derived(item.source);
</script>

<article class="item" class:fresh class:closed={!open} data-kind={item.kind} aria-label={item.title}>
  <div class="top mono">
    <span>{KINDS[item.kind]}{item.overdue ? " · late" : ""}</span>
    <time datetime={new Date(item.createdAt).toISOString()}>{when(item.updatedAt)}</time>
  </div>
  <h2>{item.title}</h2>
  {#if item.body}
    <div class="body">
      {#if item.kind === "prompt.result" || item.kind === "turn.finished"}
        <AgentText text={item.body} {vaultId} />
      {:else}
        <p class="plain">{item.body}</p>
      {/if}
    </div>
  {/if}
  {#if item.snoozedUntil !== null}<p class="muted">Snoozed until {when(item.snoozedUntil)}</p>{/if}
  {#if item.resolution}<p class="muted">{item.resolution}</p>{/if}
  {#each failedDeliveries as delivery (delivery.channel)}
    <p class="error">Couldn't deliver to {delivery.channel} after {delivery.attempts} tries: {delivery.lastError}</p>
  {/each}

  <div class="actions">
    {#if vaultId && threadId}
      <a href={threadHref(vaultId, threadId)}>{item.kind === "request" ? "Answer in the thread" : "Open thread"}</a>
    {/if}
    {#if vaultId && notePath}<a href={noteHref(vaultId, notePath)}>Open note</a>{/if}
    {#if scheduleId}<a href={scheduleHref(scheduleId)}>Schedule</a>{/if}
    {#if open}
      <label class="snooze">
        <span class="visually-hidden">Snooze {item.title}</span>
        <select
          aria-label="Snooze"
          onchange={(event) => {
            const until = Number(event.currentTarget.value);
            event.currentTarget.value = "";
            if (until > 0) void inbox.snooze(item.id, until);
          }}
        >
          <option value="">Snooze…</option>
          {#each snoozeOptions as option (option.label)}
            <option value={option.until}>{option.label}</option>
          {/each}
        </select>
      </label>
      <button type="button" onclick={() => void inbox.done(item.id)}>Done</button>
      <button type="button" onclick={() => void inbox.dismiss(item.id)}>Dismiss</button>
    {/if}
  </div>
</article>

<style>
  .item {
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .fresh {
    border-left: 3px solid var(--accent);
  }
  .item[data-kind="prompt.failed"],
  .item[data-kind="turn.failed"] {
    border-left: 3px solid var(--del);
  }
  .closed {
    opacity: 0.75;
  }
  .top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--ink-3);
    font-size: 11px;
  }
  h2 {
    margin: 4px 0 6px;
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  .body {
    font-family: var(--font-read);
    font-size: 15px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .plain {
    margin: 0;
    white-space: pre-wrap;
  }
  p {
    margin: 4px 0 0;
    font-size: 13px;
  }
  .muted {
    color: var(--ink-3);
  }
  .error {
    color: var(--del);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: 10px;
    font-size: 13px;
  }
  button,
  select {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
