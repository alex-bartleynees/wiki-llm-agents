<script lang="ts">
  import type { Schedule, ScheduleRun } from "@wiki-agents/contracts/schedules/model";
  import { SCHEDULES_PATH, scheduleHref } from "@wiki-agents/contracts/schedules/model";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import InboxViewSwitch from "#lib/features/inbox/InboxViewSwitch.svelte";
  import { threadHref } from "#lib/features/threads/thread-link.ts";
  import { usageLabel } from "#lib/features/threads/timeline.ts";
  import ScheduleForm from "./ScheduleForm.svelte";
  import { schedules } from "./schedules.svelte.ts";

  onMount(() => void schedules.load());

  /** `?edit=<id>` edits a schedule; `?new` starts one. */
  const editing = $derived(page.url.searchParams.get("edit"));
  const creating = $derived(page.url.searchParams.has("new"));
  const edited = $derived(editing === null ? undefined : schedules.byId(editing));

  const close = () => goto(SCHEDULES_PATH);

  const STATUS = { active: "Active", paused: "Paused", finished: "Finished" } as const;
  const RUN = {
    delivered: "Delivered",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    missed: "Missed",
    skipped: "Skipped",
  } as const;

  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const runCost = (run: ScheduleRun) =>
    run.inputTokens === null || run.outputTokens === null
      ? null
      : usageLabel({ inputTokens: run.inputTokens, outputTokens: run.outputTokens, costUsd: run.costUsd });

  const remove = (schedule: Schedule) => {
    if (confirm(`Delete “${schedule.title}”? Its inbox items and thread stay.`)) void schedules.remove(schedule.id);
  };
</script>

<div class="schedules-page">
  <header>
    <InboxViewSwitch view="schedules" />
    {#if !creating}<a class="new" href="{SCHEDULES_PATH}?new">New schedule</a>{/if}
  </header>

  {#if creating}
    <ScheduleForm onsaved={() => void close()} oncancel={() => void close()} />
  {/if}

  {#if schedules.error}<p class="error" role="alert">{schedules.error}</p>{/if}

  {#if schedules.status === "loading"}
    <p class="muted">Loading…</p>
  {:else if schedules.list.length === 0 && !creating}
    <p class="muted">No schedules yet. Create a reminder or a scheduled prompt, or ask an agent: “send me the morning news at 9am every day”.</p>
  {/if}

  <ul class="list">
    {#each schedules.list as schedule (schedule.id)}
      <li class="schedule" data-status={schedule.status} aria-label={schedule.title}>
        {#if edited?.id === schedule.id}
          <ScheduleForm schedule={edited} onsaved={() => void close()} oncancel={() => void close()} />
        {:else}
          <div class="top">
            <span class="kind mono">{schedule.kind === "prompt" ? "Scheduled prompt" : "Reminder"}</span>
            <span class="status mono">{STATUS[schedule.status]}</span>
          </div>
          <h2>{schedule.title}</h2>
          <p class="when">{schedule.recurrenceLabel}</p>
          <p class="next">
            {#if schedule.nextLabel}Next: <strong>{schedule.nextLabel}</strong>{:else}Won't fire again{/if}
          </p>
          {#if schedule.pausedReason}<p class="error">{schedule.pausedReason}</p>{/if}
          {#if schedule.text !== schedule.title}<p class="text">{schedule.text}</p>{/if}
          <div class="actions">
            <a href={scheduleHref(schedule.id)}>Edit</a>
            {#if schedule.status === "active"}
              <button type="button" onclick={() => void schedules.pause(schedule.id)}>Pause</button>
            {:else if schedule.status === "paused"}
              <button type="button" onclick={() => void schedules.resume(schedule.id)}>Resume</button>
            {/if}
            <button type="button" onclick={() => void schedules.runNow(schedule.id)}>Run now</button>
            <button type="button" class="danger" onclick={() => remove(schedule)}>Delete</button>
          </div>
          {#if schedule.runs.length > 0}
            <details class="runs">
              <summary>Last runs</summary>
              <ul>
                {#each schedule.runs as run (run.id)}
                  <li data-status={run.status}>
                    <span class="mono">{RUN[run.status]}</span>
                    <span>{when(run.firedAt)}{run.manual ? " · by hand" : ""}{run.overdue ? " · late" : ""}{run.coalesced > 0 ? ` · ${run.coalesced} missed` : ""}</span>
                    {#if runCost(run)}<span class="mono cost">{runCost(run)}</span>{/if}
                    {#if run.reason}<span class="reason">{run.reason}</span>{/if}
                    {#if run.threadId && schedule.vaultId}<a href={threadHref(schedule.vaultId, run.threadId)}>Open run</a>{/if}
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .schedules-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 20px 16px 40px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .new {
    padding: 6px 14px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font-size: 14px;
    text-decoration: none;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .schedule {
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .schedule[data-status="paused"],
  .schedule[data-status="finished"] {
    opacity: 0.85;
  }
  .top {
    display: flex;
    justify-content: space-between;
    color: var(--ink-3);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h2 {
    margin: 4px 0;
    font-size: 16px;
  }
  p {
    margin: 2px 0;
    font-size: 14px;
  }
  .when,
  .muted {
    color: var(--ink-3);
  }
  .text {
    white-space: pre-wrap;
    color: var(--ink-2);
  }
  .error {
    color: var(--del);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 13px;
  }
  .actions button {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .actions .danger {
    color: var(--del);
  }
  .runs {
    margin-top: 10px;
    font-size: 13px;
  }
  .runs ul {
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }
  .runs li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    padding: 4px 0;
    border-top: 1px solid var(--line);
  }
  .runs li[data-status="failed"] .mono {
    color: var(--del);
  }
  .cost,
  .reason {
    color: var(--ink-3);
  }
</style>
