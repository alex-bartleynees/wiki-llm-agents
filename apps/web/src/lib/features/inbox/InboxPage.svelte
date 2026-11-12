<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import InboxItemCard from "./InboxItemCard.svelte";
  import InboxViewSwitch from "./InboxViewSwitch.svelte";
  import { inbox } from "./inbox.svelte.ts";

  /** Items unread while you've had the inbox open stay marked new until you leave. */
  const fresh = new Set<string>();

  /** The item a notification opened (`/inbox?item=<id>`). */
  const picked = $derived(page.url.searchParams.get("item"));

  // Looking at the inbox reads what is in it, including what arrives while it is open.
  $effect(() => {
    const unread = inbox.open.filter((item) => !item.read).map((item) => item.id);
    untrack(() => {
      for (const id of unread) fresh.add(id);
      if (unread.length > 0) void inbox.read(unread);
    });
  });
</script>

<div class="inbox-page">
  <header>
    <InboxViewSwitch view="inbox" />
  </header>

  {#if inbox.error}<p class="error" role="alert">{inbox.error}</p>{/if}

  {#if inbox.status === "loading"}
    <p class="muted">Loading…</p>
  {:else if inbox.open.length === 0}
    <p class="muted">Nothing waiting. Reminders, scheduled prompts' answers, and agents waiting for you arrive here.</p>
  {/if}

  <section class="items" aria-label="Open">
    {#each inbox.open as item (item.id)}
      <InboxItemCard {item} fresh={fresh.has(item.id)} picked={item.id === picked} />
    {/each}
  </section>

  {#if inbox.snoozed.length > 0}
    <details open={inbox.snoozed.some((item) => item.id === picked)}>
      <summary>Snoozed ({inbox.snoozed.length})</summary>
      <section class="items" aria-label="Snoozed">
        {#each inbox.snoozed as item (item.id)}
          <InboxItemCard {item} picked={item.id === picked} />
        {/each}
      </section>
    </details>
  {/if}

  {#if inbox.history.length > 0}
    <details open={inbox.history.some((item) => item.id === picked)}>
      <summary>Done and dismissed</summary>
      <section class="items" aria-label="Done and dismissed">
        {#each inbox.history as item (item.id)}
          <InboxItemCard {item} picked={item.id === picked} />
        {/each}
      </section>
    </details>
  {/if}
</div>

<style>
  .inbox-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 20px 16px 40px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  details > .items {
    margin-top: 10px;
  }
  summary {
    color: var(--ink-2);
    font-size: 13px;
    cursor: pointer;
  }
  .muted {
    color: var(--ink-3);
  }
  .error {
    color: var(--del);
  }
</style>
