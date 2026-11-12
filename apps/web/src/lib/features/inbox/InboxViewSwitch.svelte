<script lang="ts">
  import { INBOX_PATH } from "@wiki-agents/contracts/inbox/model";
  import { SCHEDULES_PATH } from "@wiki-agents/contracts/schedules/model";
  import { inbox } from "./inbox.svelte.ts";

  /** The inbox, or the schedules that put things in it. */
  let { view }: { view: "inbox" | "schedules" } = $props();
</script>

<nav class="switch" aria-label="Inbox view">
  <a href={INBOX_PATH} aria-current={view === "inbox" ? "page" : undefined}>Inbox{#if inbox.unread > 0}&nbsp;({inbox.unread}){/if}</a>
  <a href={SCHEDULES_PATH} aria-current={view === "schedules" ? "page" : undefined}>Schedules</a>
</nav>

<style>
  .switch {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--sunken);
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
</style>
