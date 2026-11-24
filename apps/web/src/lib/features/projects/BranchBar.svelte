<script lang="ts">
  import type { GitStatus } from "@wiki-agents/contracts/projects/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { pushBranch } from "./api.ts";
  import Button from "#lib/ui/primitives/Button.svelte";

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
    <Button size="small" class="push" onclick={start} disabled={pushing || blocked !== null || confirming} title={blocked ?? undefined}>
      {pushing ? "Pushing…" : "Push"}
    </Button>
  </div>
  {#if confirming && status.pushRemote !== null && branch !== null}
    <div class="confirm" role="alertdialog" aria-label="Push a new branch">
      <p>{branch} has no upstream. Push it to <span class="mono">{status.pushRemote}/{branch}</span> and track it?</p>
      <div class="actions">
        <Button variant="link" onclick={() => (confirming = false)} disabled={pushing}>Cancel</Button>
        <Button variant="primary" onclick={() => push(true)} disabled={pushing}>{pushing ? "Pushing…" : `Push to ${status.pushRemote}`}</Button>
      </div>
    </div>
  {/if}
  {#if status.behind !== null && status.behind > 0}
    <p class="hint">The upstream has {status.behind} {status.behind === 1 ? "commit" : "commits"} this branch lacks. Pull or rebase with your Git client before pushing.</p>
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
  .line > :global(.push) {
    margin-left: auto;
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
</style>
