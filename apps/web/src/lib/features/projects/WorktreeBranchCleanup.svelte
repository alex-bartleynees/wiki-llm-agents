<script lang="ts">
  import type { CheckWorktreeBranchResponse } from "@wiki-agents/contracts/projects/check-worktree-branch/response";
  import type { ListedWorktree } from "@wiki-agents/contracts/projects/list-worktrees/response";
  import { errorMessage } from "#lib/api/client.ts";
  import { checkWorktreeBranch } from "./api.ts";
  import { worktrees } from "./worktrees.svelte.ts";

  let { worktree }: { worktree: ListedWorktree } = $props();
  let dialog: HTMLDialogElement;
  const heading = $props.id();
  let checking = $state(false);
  let deleting = $state(false);
  let result = $state<CheckWorktreeBranchResponse | null>(null);
  let error = $state<string | null>(null);
  let attempt = 0;

  function close() {
    ++attempt;
    dialog.close();
  }

  async function check() {
    const current = ++attempt;
    const { projectId, threadId } = worktree;
    result = null;
    error = null;
    checking = true;
    if (!dialog.open) dialog.showModal();
    try {
      const response = await checkWorktreeBranch(projectId, threadId);
      if (response.status === "deleted") {
        worktrees.markBranchDeleted(projectId, threadId);
        void worktrees.load(projectId);
      }
      if (attempt === current) result = response;
    } catch (cause) {
      if (attempt === current) error = errorMessage(cause, "Could not check the branch");
    } finally {
      if (attempt === current) checking = false;
    }
  }

  async function confirm() {
    if (result?.status !== "ready" || deleting) return;
    const { projectId, threadId } = worktree;
    deleting = true;
    try {
      await worktrees.deleteBranch(projectId, threadId, result.confirmation);
      close();
    } catch (cause) {
      result = null;
      error = errorMessage(cause, "Could not delete the branch");
    } finally {
      deleting = false;
    }
  }
</script>

<span class="branch-status">
  <span>{worktree.branchDeleted ? "Branch deleted" : "Branch kept"}</span>
  {#if !worktree.branchDeleted}
    <button type="button" class="open" onclick={check}>Delete branch…</button>
  {/if}
</span>

<dialog bind:this={dialog} aria-labelledby={heading} oncancel={(event) => {
  event.preventDefault();
  if (!deleting) close();
}}>
  <h2 id={heading}>Delete local branch</h2>
  <p><strong>{worktree.branch}</strong></p>
  <p>This deletes the local branch only. The remote branch and worktree history stay.</p>
  {#if deleting}
    <p role="status">Deleting branch…</p>
  {:else if checking}
    <p role="status">Checking the branch and fetching the merge target…</p>
  {:else if result?.status === "ready"}
    <p>Merged into <strong>{result.target}</strong>.</p>
  {:else if result?.status === "blocked"}
    <p role="status">{result.reason}</p>
  {:else if result?.status === "deleted"}
    <p role="status">Branch deleted</p>
  {:else if error}
    <p role="alert">{error}</p>
  {/if}
  <div class="actions">
    <button type="button" disabled={deleting} onclick={close}>{result?.status === "deleted" ? "Close" : "Cancel"}</button>
    {#if result?.status === "ready"}
      <button type="button" disabled={deleting} onclick={confirm}>Delete local branch</button>
    {:else if !checking && (result?.status === "blocked" || error)}
      <button type="button" onclick={check}>Check again</button>
    {/if}
  </div>
</dialog>

<style>
  .branch-status, .actions {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  button {
    cursor: pointer;
    font: inherit;
  }
  .open {
    color: var(--accent-ink);
    background: transparent;
    border: 0;
    text-decoration: underline;
  }
  dialog {
    box-sizing: border-box;
    width: min(420px, calc(100% - 32px));
    padding: 20px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow-wrap: anywhere;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 50%);
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .actions button {
    min-height: 44px;
  }
  @media (max-width: 899px) {
    .open {
      min-height: 44px;
    }
  }
</style>
