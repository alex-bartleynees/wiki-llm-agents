<script lang="ts">
  import type { GitStatus } from "@wiki-agents/contracts/projects/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { pushBranch } from "./api.ts";

  /**
   * A git directory's branch, its upstream and ahead/behind (as of the last fetch), and
   * **Push**: the checked-out branch to its upstream, never forced. A branch without an
   * upstream asks first, naming the remote and branch. A rejected push shows git's
   * message; pull or rebase in lazygit.
   */
  let { projectId, status, onpushed }: { projectId: string; status: GitStatus; onpushed: (status: GitStatus) => void } = $props();

  let pushing = $state(false);
  let confirming = $state(false);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);

  const branch = $derived(status.branch);
  const upstream = $derived(status.upstream === null ? null : `${status.upstream.remote}/${status.upstream.branch}`);
  /** Why Push can't be pressed now, or null. */
  const blocked = $derived(
    branch === null
      ? "No branch is checked out"
      : status.head === null
        ? "No commits yet"
        : status.upstream === null && status.pushRemote === null
          ? "No remote to push to"
          : status.ahead === 0
            ? "Nothing to push"
            : null,
  );

  async function push(setUpstream: boolean) {
    if (branch === null) return;
    pushing = true;
    error = null;
    done = null;
    try {
      const result = await pushBranch(projectId, {
        directory: status.directory,
        branch,
        ...(setUpstream && status.pushRemote !== null ? { setUpstream: { remote: status.pushRemote } } : {}),
      });
      confirming = false;
      done = `Pushed ${branch} to ${result.status.upstream === null ? "its remote" : `${result.status.upstream.remote}/${result.status.upstream.branch}`}.`;
      onpushed(result.status);
    } catch (cause) {
      error = errorMessage(cause, "Could not push");
    } finally {
      pushing = false;
    }
  }

  function start() {
    if (status.upstream === null) confirming = true;
    else void push(false);
  }
</script>

<div class="bar" role="group" aria-label="Branch {branch ?? 'detached HEAD'}">
  <div class="line mono">
    <span class="branch" title={branch ?? "detached HEAD"}>⎇ {branch ?? "detached HEAD"}</span>
    {#if upstream !== null}
      <span class="upstream" title="Upstream, as of the last fetch">→ {upstream}</span>
      {#if status.ahead !== null && status.behind !== null}
        <span class="counts" aria-label="{status.ahead} ahead, {status.behind} behind">↑{status.ahead} ↓{status.behind}</span>
      {/if}
    {:else if branch !== null}
      <span class="upstream">no upstream</span>
    {/if}
    <button type="button" class="push" onclick={start} disabled={pushing || blocked !== null || confirming} title={blocked ?? undefined}>
      {pushing ? "Pushing…" : "Push"}
    </button>
  </div>
  {#if confirming && status.pushRemote !== null && branch !== null}
    <div class="confirm" role="alertdialog" aria-label="Push a new branch">
      <p>{branch} has no upstream. Push it to <span class="mono">{status.pushRemote}/{branch}</span> and track it?</p>
      <div class="actions">
        <button type="button" class="link" onclick={() => (confirming = false)} disabled={pushing}>Cancel</button>
        <button type="button" class="primary" onclick={() => push(true)} disabled={pushing}>{pushing ? "Pushing…" : `Push to ${status.pushRemote}`}</button>
      </div>
    </div>
  {/if}
  {#if status.behind !== null && status.behind > 0}
    <p class="hint">The upstream has {status.behind} {status.behind === 1 ? "commit" : "commits"} this branch lacks; pull or rebase in lazygit before pushing.</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if done}<p class="done" role="status">{done}</p>{/if}
</div>

<style>
  .bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
  .branch {
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .upstream,
  .counts {
    color: var(--ink-3);
  }
  .push {
    margin-left: auto;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .push:disabled {
    color: var(--ink-3);
    cursor: default;
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--sunken);
  }
  .confirm p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .hint,
  .error,
  .done {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .hint,
  .done {
    color: var(--ink-2);
  }
  .error {
    color: var(--del);
  }
  @media (max-width: 899px) {
    .push {
      height: 36px;
      font-size: 14px;
    }
  }
</style>
