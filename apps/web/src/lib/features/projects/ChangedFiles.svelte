<script lang="ts">
  import type { FileChange, Project } from "@wiki-agents/contracts/projects/model";
  import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
  import type { ThreadStatus } from "@wiki-agents/contracts/threads/model";
  import { untrack } from "svelte";
  import { errorMessage } from "#lib/api/client.ts";
  import { listen } from "#lib/api/sse.ts";
  import { vaultThreadsTopic } from "#lib/features/threads/api.ts";
  import { listChanges, reviewChanges } from "./api.ts";

  let { project }: { project: Project } = $props();

  /** Rows shown per folder before "more". */
  const PER_FOLDER = 12;
  const LETTER: Record<FileChange["status"], string> = { created: "A", modified: "M", deleted: "D" };

  let changes = $state<ReadonlyArray<FileChange> | null>(null);
  /** Working directories compared with `HEAD`; the rest compare with the reviewed baseline. */
  let gitDirectories = $state<ReadonlySet<string>>(new Set());
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Folders showing every row. */
  let expanded = $state<ReadonlySet<string>>(new Set());

  const folderName = (directory: string) => directory.split("/").filter(Boolean).at(-1) ?? directory;

  /** Every working directory, in the project's order, with its changes. */
  const folders = $derived(
    project.workingDirectories.map((directory) => ({
      directory,
      files: (changes ?? []).filter((change) => change.directory === directory),
    })),
  );
  const total = $derived(changes?.length ?? 0);
  const outsideGit = $derived(project.workingDirectories.filter((directory) => !gitDirectories.has(directory)));
  /** Changes that "mark all reviewed" clears: those outside git. */
  const reviewable = $derived((changes ?? []).filter((change) => !gitDirectories.has(change.directory)).length);
  const heading = $derived(
    changes === null || outsideGit.length === project.workingDirectories.length
      ? "changed since registered or reviewed"
      : outsideGit.length === 0
        ? "uncommitted changes"
        : "uncommitted, or changed since reviewed outside git",
  );

  async function run(action: (projectId: string) => Promise<unknown>, fallback: string) {
    const id = project.id;
    busy = true;
    error = null;
    try {
      await action(id);
      const result = await listChanges(id);
      if (project.id === id) {
        changes = result.changes;
        gitDirectories = new Set(result.gitDirectories);
      }
    } catch (cause) {
      if (project.id === id) error = errorMessage(cause, fallback);
    } finally {
      busy = false;
    }
  }

  const scan = () => run(async () => {}, "Could not scan the project's folders");
  const markReviewed = () => run(reviewChanges, "Could not mark the changes reviewed");

  // Scanned whenever another project is shown, and again when one of its turns ends.
  $effect(() => {
    const { id, vaultId } = project;
    untrack(() => {
      changes = null;
      gitDirectories = new Set();
      expanded = new Set();
      void scan();
    });
    const statuses = new Map<string, ThreadStatus>();
    return listen(vaultThreadsTopic(vaultId), ThreadsStreamMessage, {
      onEvent: (message) => {
        if (message.type !== "thread.updated" || message.thread.projectId !== id) return;
        const before = statuses.get(message.thread.id);
        statuses.set(message.thread.id, message.thread.status);
        if (before !== undefined && before !== "idle" && message.thread.status === "idle" && !busy) void scan();
      },
      onReconnect: () => void scan(),
    });
  });
</script>

<section aria-label="Changed files">
  <div class="head">
    <h2 class="mono">{heading}{changes === null ? "" : ` · ${total} ${total === 1 ? "file" : "files"}`}</h2>
    <span class="hint"><a href="/projects/{project.id}/diff">Review the diff</a> and comment; commit or undo in lazygit.</span>
    <span class="actions">
      <button type="button" onclick={scan} disabled={busy}>{busy ? "Scanning…" : "Rescan"}</button>
      {#if changes === null || outsideGit.length > 0}
        <button type="button" onclick={markReviewed} disabled={busy || reviewable === 0}>Mark all reviewed</button>
      {/if}
    </span>
  </div>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if changes !== null}
    <div class="table">
      {#each folders as folder (folder.directory)}
        <div class="folder mono" title={folder.directory}>
          {folderName(folder.directory)} · {folder.files.length}
          {folder.files.length === 1 ? "file" : "files"}
        </div>
        {#each expanded.has(folder.directory) ? folder.files : folder.files.slice(0, PER_FOLDER) as change (change.path)}
          <div class="row mono">
            <span class="status" data-status={change.status} title={change.status}>{LETTER[change.status]}</span>
            <span class="path" title={change.path}>{change.path}</span>
          </div>
        {/each}
        {#if folder.files.length > PER_FOLDER && !expanded.has(folder.directory)}
          <button type="button" class="more mono" onclick={() => (expanded = new Set([...expanded, folder.directory]))}>
            + {folder.files.length - PER_FOLDER} more
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px 14px;
  }
  h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-3);
  }
  .hint {
    font-size: 13px;
    color: var(--ink-2);
  }
  .actions {
    margin-left: auto;
    display: flex;
    gap: 14px;
  }
  .actions button {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .actions button:hover:not(:disabled) {
    color: var(--ink);
  }
  .actions button:disabled {
    color: var(--ink-3);
    cursor: default;
  }
  .table {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .folder {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line-soft);
    background: var(--sunken);
    font-size: 12px;
    color: var(--ink-2);
  }
  .row + .folder,
  .more + .folder {
    border-top: 1px solid var(--line-soft);
  }
  .row {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 12px;
    padding: 7px 12px;
    font-size: 12px;
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status[data-status="modified"] {
    color: var(--agent);
  }
  .status[data-status="created"] {
    color: var(--ins);
  }
  .status[data-status="deleted"] {
    color: var(--del);
  }
  .more {
    display: block;
    width: 100%;
    padding: 7px 12px;
    font-size: 12px;
    border: 0;
    background: transparent;
    color: var(--ink-3);
    text-align: left;
    cursor: pointer;
  }
  .more:hover {
    color: var(--ink);
  }
  .error {
    margin: 0;
    color: var(--del);
  }
</style>
