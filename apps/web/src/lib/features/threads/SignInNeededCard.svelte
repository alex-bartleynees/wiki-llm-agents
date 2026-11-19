<script lang="ts">
  import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";

  let { card }: { card: Extract<ThreadEvent, { readonly _tag: "browser.sign_in_needed" }> } = $props();
</script>

<!-- A page the agent opened wants a sign-in the project doesn't have. You add it in the project, never here. -->
<section class="card" aria-label="{card.site} needs a sign-in">
  <header class="mono">Browser sign-in</header>
  <p class="title">{card.site} needs a sign-in</p>
  <p class="origin mono">{card.origin}</p>
  {#if card.reason !== null}<p>{card.reason}</p>{/if}
  <p class="muted">
    Add a test account to the project: its username and password are stored as secrets, and the browser types them when the
    agent asks. Don't type a password in this conversation. The browser has it from your next message.
  </p>
  <a class="add" href={card.href}>Add a sign-in</a>
</section>

<style>
  .card {
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 13px;
  }
  header {
    color: var(--accent);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  p {
    margin: 0 0 6px;
    overflow-wrap: anywhere;
  }
  .title {
    margin-top: 4px;
    font-weight: 600;
  }
  .origin,
  .muted {
    color: var(--ink-3);
  }
  .origin {
    font-size: 12px;
  }
  .add {
    color: var(--accent-ink);
    font-weight: 600;
  }
</style>
