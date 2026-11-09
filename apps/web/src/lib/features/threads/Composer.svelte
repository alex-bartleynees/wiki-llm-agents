<script lang="ts">
  import { openThread } from "./open-thread.svelte.ts";

  let text = $state("");
  const running = $derived(openThread.running);

  const submit = async () => {
    const message = text.trim();
    if (message === "" || running) return;
    if (await openThread.send(message)) text = "";
  };
</script>

<form
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <textarea
    bind:value={text}
    rows="2"
    placeholder={running ? "The agent is working…" : "Message the agent (Enter to send, Shift+Enter for a new line)"}
    aria-label="Message"
    onkeydown={(event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void submit();
      }
    }}
  ></textarea>
  {#if running}
    <button type="button" class="stop" onclick={() => openThread.stop()}>Stop</button>
  {:else}
    <button type="submit" class="send" disabled={openThread.sending || text.trim() === ""}>Send</button>
  {/if}
</form>

<style>
  form {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid var(--line-soft);
    background: var(--surface);
  }
  textarea {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 40px;
    max-height: 30vh;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    /* 16px stops iOS from zooming into the field. */
    font-size: max(14px, 1em);
    resize: vertical;
  }
  button {
    height: 40px;
    padding: 0 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .stop {
    border-color: var(--del);
    background: transparent;
    color: var(--del);
  }
  @media (max-width: 899px) {
    textarea {
      font-size: 16px;
    }
  }
</style>
