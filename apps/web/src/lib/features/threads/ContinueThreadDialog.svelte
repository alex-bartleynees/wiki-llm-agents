<script lang="ts">
  import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { agents } from "#lib/features/agents/agents.svelte.ts";
  import { suggestedBranch, worktrees } from "#lib/features/projects/worktrees.svelte.ts";
  import { continueThread } from "./api.ts";
  import { HANDOFF_TEMPLATE, type WorkspaceChoice, workspaceOf } from "./handoff.ts";
  import { openThread } from "./open-thread.svelte.ts";
  import { providers } from "./providers.svelte.ts";
  import { threads } from "./threads.svelte.ts";
  import Button from "#lib/ui/primitives/Button.svelte";

  /**
   * Continue in a new thread: the handoff to review and edit, what the new thread
   * keeps (agent, provider, model), and, in a project, where it works. Starting makes
   * the thread with the handoff as its draft and opens it; nothing is sent. With no
   * handoff yet, it offers to ask the agent for one (a turn in this thread) or to write
   * it from the template.
   */
  let {
    open = $bindable(false),
    source,
    handoff,
  }: {
    open?: boolean;
    source: ThreadSummary;
    /** The agent's handoff to start from; null to start from the template. */
    handoff: string | null;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let text = $state("");
  let choice = $state<WorkspaceChoice>("same");
  let branch = $state("");
  let starting = $state(false);
  let error = $state<string | null>(null);

  const provider = $derived(providers.get(source.providerInstanceId));
  const agent = $derived(agents.get(source.agentId));
  const worktree = $derived(worktrees.forThread(source.projectId, source.id));
  const liveWorktree = $derived(worktree !== undefined && worktree.removedAt === null && worktree.exists ? worktree : undefined);
  const canMakeWorktree = $derived(worktrees.available(source.projectId));
  const idle = $derived(openThread.timeline.runningTurn === null);

  $effect(() => {
    if (dialog === undefined) return;
    if (open && !dialog.open) {
      text = handoff ?? HANDOFF_TEMPLATE;
      branch = suggestedBranch();
      error = null;
      if (source.projectId !== null) void worktrees.load(source.projectId);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  // A worktree that's gone can't be shared: start from the main directory instead.
  $effect(() => {
    if (open && choice === "same" && worktree !== undefined && liveWorktree === undefined) choice = "main";
  });

  const ask = async () => {
    open = false;
    await openThread.handoff();
  };

  const start = async () => {
    if (starting || text.trim() === "") return;
    starting = true;
    error = null;
    try {
      const { thread } = await continueThread(source.id, { text, workspace: workspaceOf(choice, branch) });
      if (choice === "worktree" && source.projectId !== null) await worktrees.load(source.projectId);
      open = false;
      await threads.select(thread.id);
    } catch (cause) {
      error = errorMessage(cause, "Couldn't start the new thread");
    } finally {
      starting = false;
    }
  };
</script>

<dialog bind:this={dialog} aria-labelledby="continue-heading" onclose={() => (open = false)}>
  <header>
    <h2 id="continue-heading">Continue in a new thread</h2>
    <button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>×</button>
  </header>
  <div class="body">
    <p>
      The new thread starts a fresh {provider?.name ?? "provider"} session, so it knows only what you send it. This thread stays as it is.
    </p>
    <p class="keeps mono">
      {agent?.name ?? "No agent"} · {provider?.name ?? source.providerInstanceId} · {source.model ?? "default model"}
    </p>

    {#if handoff === null}
      <div class="ask">
        <Button disabled={!idle || openThread.handingOff} onclick={ask}>Ask {agent?.name ?? "the agent"} to write it</Button>
        <span>A turn in this thread: it uses some of your usage. Or write it yourself below.</span>
      </div>
    {/if}

    <label for="handoff-text">Handoff</label>
    <textarea id="handoff-text" bind:value={text} rows="12" spellcheck="true"></textarea>

    {#if source.projectId !== null}
      <fieldset>
        <legend>Where it works</legend>
        {#if worktree !== undefined}
          <label class="choice">
            <input type="radio" name="workspace" value="same" bind:group={choice} disabled={liveWorktree === undefined} />
            <span>
              This thread's worktree <span class="mono">⎇ {worktree.branch}</span>
              <small>{liveWorktree === undefined ? "It's gone, so it can't be shared." : "Shared: both threads work in the same files."}</small>
            </span>
          </label>
          <label class="choice">
            <input type="radio" name="workspace" value="main" bind:group={choice} />
            <span>
              The project's main directory
              <small>Without this worktree's branch or uncommitted changes.</small>
            </span>
          </label>
        {:else}
          <label class="choice">
            <input type="radio" name="workspace" value="same" bind:group={choice} />
            <span>
              The project's main directory, like this thread
              <small>The same files this thread works in.</small>
            </span>
          </label>
        {/if}
        {#if canMakeWorktree}
          <label class="choice">
            <input type="radio" name="workspace" value="worktree" bind:group={choice} />
            <span>
              A new worktree from <span class="mono">HEAD</span>
              <small>A clean checkout: it won't have uncommitted work.</small>
            </span>
          </label>
          {#if choice === "worktree"}
            <label class="branch">
              <span>Branch</span>
              <input type="text" bind:value={branch} autocapitalize="off" autocomplete="off" spellcheck="false" />
            </label>
          {/if}
        {/if}
      </fieldset>
    {/if}

    <p class="muted">Nothing is sent: the handoff waits in the new thread's message box until you send it. You can change the agent and model there first.</p>
    {#if error !== null}
      <p class="error" role="alert">{error}</p>
    {/if}
  </div>
  <footer>
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button
      variant="primary"
      disabled={starting || text.trim() === "" || (choice === "worktree" && branch.trim() === "")}
      onclick={start}>{starting ? "Starting…" : "Start new thread"}</Button
    >
  </footer>
</dialog>

<style>
  dialog {
    width: min(640px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    margin: 6vh auto auto;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.25);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .close {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 20px;
    cursor: pointer;
  }
  .body {
    display: grid;
    gap: 10px;
    padding: 16px;
    overflow: auto;
    font-size: 14px;
  }
  p {
    margin: 0;
  }
  .keeps {
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .ask {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 12px;
    color: var(--ink-3);
  }
  label[for="handoff-text"],
  legend {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-2);
  }
  textarea {
    width: 100%;
    min-height: 200px;
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
  }
  fieldset {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 8px 10px 10px;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
  }
  .choice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
  }
  .choice input {
    margin-top: 3px;
  }
  .choice small {
    display: block;
    color: var(--ink-3);
    font-size: 12px;
  }
  .branch {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 24px;
    font-size: 12px;
  }
  .branch input {
    flex: 1 1 auto;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .muted {
    color: var(--ink-3);
    font-size: 12px;
  }
  .error {
    color: var(--del);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--line-soft);
  }
  @media (max-width: 899px) {
    dialog {
      margin-top: 12px;
    }
    textarea,
    .branch input {
      font-size: 16px;
    }
    .branch input {
      height: 36px;
    }
  }
</style>
