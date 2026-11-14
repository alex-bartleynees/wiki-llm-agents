<script lang="ts">
  import { INBOX_PATH } from "@wiki-agents/contracts/inbox/model";
  import { NOTIFICATIONS_PATH } from "@wiki-agents/contracts/notifications/model";
  import { SCHEDULES_PATH } from "@wiki-agents/contracts/schedules/model";
  import { RUNNING_PATH } from "@wiki-agents/contracts/threads/model";
  import { running } from "#lib/features/threads/running.svelte.ts";
  import { inbox } from "./inbox.svelte.ts";

  /** The inbox, the threads still at work, the schedules that put things in it, or how it reaches your devices. */
  let { view }: { view: "inbox" | "running" | "schedules" | "notifications" } = $props();
</script>

<nav class="switch" aria-label="Inbox view">
  <a href={INBOX_PATH} aria-current={view === "inbox" ? "page" : undefined}>Inbox{#if inbox.unread > 0}&nbsp;({inbox.unread}){/if}</a>
  <a href={RUNNING_PATH} aria-current={view === "running" ? "page" : undefined}>Running{#if running.count > 0}&nbsp;({running.count}){/if}</a>
  <a href={SCHEDULES_PATH} aria-current={view === "schedules" ? "page" : undefined}>Schedules</a>
  <a href={NOTIFICATIONS_PATH} aria-current={view === "notifications" ? "page" : undefined}>Notifications</a>
</nav>

<style>
  .switch {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--sunken);
    max-width: 100%;
    overflow-x: auto;
  }
  a {
    flex: 1;
    padding: 5px 14px;
    border-radius: 3px;
    color: var(--ink-2);
    font-size: 13px;
    text-align: center;
    text-decoration: none;
    white-space: nowrap;
  }
  a:hover {
    color: var(--ink);
  }
  a[aria-current="page"] {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  }
  @media (max-width: 480px) {
    a {
      padding: 5px 8px;
    }
  }
</style>
