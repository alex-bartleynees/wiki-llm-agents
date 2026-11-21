<script lang="ts">
  import type { MarkAllDoneTarget } from "@wiki-agents/contracts/inbox/mark-all-done/request";
  import { errorMessage } from "#lib/api/client.ts";
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import InboxItemCard from "./InboxItemCard.svelte";
  import InboxViewSwitch from "./InboxViewSwitch.svelte";
  import { inbox } from "./inbox.svelte.ts";

  let dialog: HTMLDialogElement;
  let targets = $state<ReadonlyArray<MarkAllDoneTarget>>([]);
  let completionError = $state<string | null>(null);
  let completed = $state<number | null>(null);

  const confirmCompletion = () => {
    targets = inbox.eligible.map(({ id, source }) => ({ itemId: id, turnId: source.turnId }));
    completionError = null;
    completed = null;
    dialog.showModal();
  };

  const complete = async () => {
    if (inbox.completing) return;
    completionError = null;
    try {
      completed = await inbox.completeAll(targets);
      dialog.close();
    } catch (cause) {
      completionError = errorMessage(cause, "Could not mark inbox items done");
    }
  };

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
    <button type="button" disabled={inbox.status !== "loaded" || inbox.completing || inbox.eligible.length === 0} onclick={confirmCompletion}>
      Mark all as done
    </button>
  </header>

  <dialog bind:this={dialog} aria-labelledby="complete-inbox-heading" aria-describedby="complete-inbox-scope"
    oncancel={(event) => { if (inbox.completing) event.preventDefault(); }}>
    <h2 id="complete-inbox-heading">Mark {targets.length} {targets.length === 1 ? "item" : "items"} as done?</h2>
    <p id="complete-inbox-scope">Approvals, questions, snoozed items and new arrivals stay in the inbox.</p>
    {#if completionError}<p class="error" role="alert">{completionError}</p>{/if}
    <footer>
      <button type="button" disabled={inbox.completing} onclick={() => dialog.close()}>Cancel</button>
      <button type="button" disabled={inbox.completing} onclick={complete}>
        {inbox.completing ? "Marking done…" : completionError ? "Retry" : "Mark done"}
      </button>
    </footer>
  </dialog>

  <div role="status">
    {#if completed !== null}Marked {completed} {completed === 1 ? "item" : "items"} done.{/if}
  </div>

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
  header, footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }
  footer {
    justify-content: flex-end;
  }
  button {
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  dialog {
    box-sizing: border-box;
    width: min(440px, calc(100vw - 32px));
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  dialog h2 {
    margin: 0;
    font-size: 16px;
  }
  [role="status"]:empty {
    position: absolute;
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
