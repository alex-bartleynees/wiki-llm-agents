<script lang="ts">
  import type { GetChangeResponse } from "@wiki-agents/contracts/changes/get-change/response";
  import type { FileChange } from "@wiki-agents/contracts/changes/model";
  import { ApiError, errorMessage } from "#lib/api/client.ts";
  import { getChange, undoChange } from "./api.ts";
  import ChangeVersions from "./ChangeVersions.svelte";
  import DiffView from "./DiffView.svelte";

  /** One turn's changes to the vault's notes: what changed, by whom, the diff, and undo. */
  let { vaultId, changes }: { vaultId: string; changes: Array<FileChange & { undone: boolean }> } = $props();

  interface FileState {
    busy: boolean;
    error?: string | undefined;
    /** Why the versions are shown: undo was refused, or you asked for the whole file. */
    versions?: { readonly reason: "conflict" | "asked"; readonly change: GetChangeResponse } | undefined;
  }
  let states = $state<Record<string, FileState>>({});
  /** The file's state as the reactive proxy (an assignment expression would give back the plain object). */
  const stateOf = (id: string): FileState => {
    states[id] ??= { busy: false };
    return states[id];
  };

  const KIND = { create: "Created", modify: "Edited", delete: "Deleted" } as const;

  const showVersions = async (change: FileChange, reason: "conflict" | "asked") => {
    const state = stateOf(change.id);
    try {
      state.versions = { reason, change: await getChange(change.id) };
    } catch (error) {
      state.error = errorMessage(error, "Could not load the versions");
    }
  };

  const undo = async (change: FileChange & { undone: boolean }) => {
    const state = stateOf(change.id);
    state.busy = true;
    state.error = undefined;
    try {
      await undoChange(change.id);
      change.undone = true;
      state.versions = undefined;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        state.error = error.message;
        await showVersions(change, "conflict");
      } else {
        state.error = errorMessage(error, "Could not undo the change");
      }
    } finally {
      state.busy = false;
    }
  };

  const noteHref = (path: string) => `/vaults/${encodeURIComponent(vaultId)}?note=${encodeURIComponent(path)}`;
  const label = $derived(`${changes.length} ${changes.length === 1 ? "note" : "notes"} changed`);
</script>

<section class="card" aria-label="Changes in this turn">
  <p class="kind mono">{label}</p>
  <ul>
    {#each changes as change (change.id)}
      {@const state = states[change.id]}
      <li data-undone={change.undone} aria-label={`${KIND[change.change]} ${change.path}`}>
        <div class="row">
          <span class="badge mono" data-change={change.change}>{KIND[change.change]}</span>
          {#if change.change === "delete" && !change.undone}
            <span class="path mono">{change.path}</span>
          {:else}
            <a class="path mono" href={noteHref(change.path)}>{change.path}</a>
          {/if}
          <span class="counts mono"><span class="ins">+{change.additions}</span> <span class="del">−{change.deletions}</span></span>
        </div>
        {#if change.attribution === "uncertain"}
          <p class="attribution">Not reported by the agent: you, sync, or one of its commands may have made this change.</p>
        {/if}
        {#each change.warnings as warning (warning)}
          <p class="warning" role="note">⚠ {warning}</p>
        {/each}
        <details>
          <summary class="mono">Diff</summary>
          <DiffView diff={change.diff} label={`Diff of ${change.path}`} />
          {#if change.truncated}
            <p class="muted">The diff was cut to fit. <button type="button" class="link" onclick={() => showVersions(change, "asked")}>Show whole versions</button></p>
          {/if}
        </details>
        <div class="actions">
          {#if change.undone}
            <span class="undone mono">Undone</span>
          {:else}
            <button type="button" disabled={state?.busy} onclick={() => undo(change)}>Undo</button>
            {#if state?.versions === undefined}
              <button type="button" class="link" onclick={() => showVersions(change, "asked")}>Compare versions</button>
            {/if}
          {/if}
        </div>
        {#if state?.error}
          <p class="error" role="alert">{state.error}</p>
        {/if}
        {#if state?.versions}
          <ChangeVersions change={state.versions.change} />
          <button type="button" class="link" onclick={() => (stateOf(change.id).versions = undefined)}>Hide versions</button>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .card {
    container: changes / inline-size;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--agent);
    border-radius: var(--radius);
    background: var(--surface);
  }
  p {
    margin: 0;
  }
  .kind {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--agent);
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li + li {
    padding-top: 10px;
    border-top: 1px solid var(--line-soft);
  }
  li[data-undone="true"] .row {
    opacity: 0.6;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .badge {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--ink-2);
  }
  .badge[data-change="create"] {
    color: var(--ins);
  }
  .badge[data-change="delete"] {
    color: var(--del);
  }
  .path {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .counts {
    flex: 0 0 auto;
    font-size: 11px;
  }
  .ins {
    color: var(--ins);
  }
  .del {
    color: var(--del);
  }
  .attribution,
  .muted {
    margin-top: 4px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .warning {
    margin-top: 4px;
    font-size: 12px;
    color: var(--agent);
  }
  details {
    margin-top: 6px;
  }
  summary {
    font-size: 12px;
    color: var(--ink-2);
    cursor: pointer;
    margin-bottom: 6px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  button {
    min-height: 32px;
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
  button.link {
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font-size: 12px;
  }
  .undone {
    font-size: 11px;
    color: var(--ink-3);
  }
  .error {
    margin-top: 6px;
    font-size: 12px;
    color: var(--del);
  }
</style>
