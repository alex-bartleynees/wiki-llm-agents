<script lang="ts">
  import type { CommitChangesResponse } from "@wiki-agents/contracts/projects/commit-changes/response";
  import type { SuggestCommitMessageResponse } from "@wiki-agents/contracts/projects/suggest-commit-message/response";
  import type { DiffFile, DirectoryDiff } from "@wiki-agents/contracts/projects/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { usageLabel } from "#lib/features/threads/timeline.ts";
  import { commitChanges, suggestCommitMessage } from "./api.ts";
  import { commitRequest } from "./commit-request.ts";

  /**
   * A message and **Commit** for one git directory: commits exactly the ticked files,
   * whole, as you reviewed them (the server refuses if any moved since). Hooks run;
   * a failure shows their output and nothing is committed. **Suggest message** asks the
   * model chosen in Settings for a message from the ticked files' diffs, to edit.
   */
  let {
    projectId,
    directory,
    label,
    files,
    ignoredCount,
    running,
    oncommitted,
    onfailed,
  }: {
    projectId: string;
    directory: DirectoryDiff;
    label: string;
    /** The ticked files, as the review listed them. */
    files: ReadonlyArray<DiffFile>;
    /** How many of them are ignored files you ticked. */
    ignoredCount: number;
    /** A turn is running in this directory, so files may still change. */
    running: boolean;
    oncommitted: (result: CommitChangesResponse) => void;
    /** The review may be out of date: reload it. */
    onfailed: () => void;
  } = $props();

  let message = $state("");
  let committing = $state(false);
  let error = $state<string | null>(null);
  let output = $state<string | null>(null);
  let committed = $state<CommitChangesResponse["commit"] | null>(null);

  let suggesting = $state(false);
  let suggestion = $state<SuggestCommitMessageResponse | null>(null);
  /** What the message said before the suggestion replaced it, to put back. */
  let before = $state<string | null>(null);

  const count = $derived(files.length);
  const ready = $derived(count > 0 && message.trim() !== "" && !committing && !suggesting);

  /** Who answered and what it cost: "Claude Code · haiku · 1.2K in · 14 out · $0.001". */
  const suggestedBy = (result: SuggestCommitMessageResponse) =>
    [result.provider.providerName, ...(result.provider.model === null ? [] : [result.provider.model]), ...(result.usage === null ? [] : [usageLabel(result.usage)])].join(" · ");

  async function suggest() {
    if (count === 0 || suggesting) return;
    suggesting = true;
    error = null;
    try {
      const result = await suggestCommitMessage(projectId, { directory: directory.directory, paths: files.map((file) => file.path) });
      before = message.trim() === "" ? null : message;
      message = result.message;
      suggestion = result;
    } catch (cause) {
      error = errorMessage(cause, "Could not suggest a message");
    } finally {
      suggesting = false;
    }
  }

  function restore() {
    if (before === null) return;
    message = before;
    before = null;
    suggestion = null;
  }

  async function commit() {
    if (!ready) return;
    committing = true;
    error = null;
    output = null;
    committed = null;
    try {
      const result = await commitChanges(projectId, commitRequest(directory, files, message));
      committed = result.commit;
      output = result.output === "" ? null : result.output;
      message = "";
      suggestion = null;
      before = null;
      oncommitted(result);
    } catch (cause) {
      error = errorMessage(cause, "Could not commit");
      onfailed();
    } finally {
      committing = false;
    }
  }
</script>

<form
  class="commit"
  aria-label="Commit in {label}"
  onsubmit={(event) => {
    event.preventDefault();
    void commit();
  }}
>
  {#if running}<p class="note">A turn is running here, so files may still change; a file that moves after you review it won't be committed.</p>{/if}
  <textarea
    bind:value={message}
    rows="3"
    placeholder="Commit message"
    aria-label="Commit message for {label}"
    autocapitalize="sentences"
    spellcheck="true"
    onkeydown={(event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void commit();
      }
    }}
  ></textarea>
  {#if suggestion}
    <p class="suggested" role="status" aria-label="Suggested by">
      Suggested by {suggestedBy(suggestion)}{suggestion.truncated ? " · some diffs left out" : ""}
      {#if before !== null}<button type="button" class="link" onclick={restore}>Put back yours</button>{/if}
    </p>
  {/if}
  <div class="actions">
    <span class="summary mono">
      {count}
      {count === 1 ? "file" : "files"}{ignoredCount === 0 ? "" : `, ${ignoredCount} ignored`}
    </span>
    <span class="buttons">
      <button type="button" class="secondary" onclick={suggest} disabled={count === 0 || suggesting || committing}>
        {suggesting ? "Suggesting…" : "Suggest message"}
      </button>
      <button type="submit" class="primary" disabled={!ready}>{committing ? "Committing…" : "Commit"}</button>
    </span>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if committed}
    <p class="done" role="status"><span class="mono">{committed.shortHash}</span> {committed.subject}</p>
  {/if}
  {#if output}<pre class="output">{output}</pre>{/if}
</form>

<style>
  .commit {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 6px 0 12px;
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    resize: vertical;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .summary {
    color: var(--ink-3);
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .secondary {
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .secondary:disabled {
    color: var(--ink-3);
    cursor: default;
  }
  .suggested {
    margin: 0;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .link {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    height: 32px;
    padding: 0 14px;
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
  .note,
  .done,
  .error {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .note,
  .done {
    color: var(--ink-2);
  }
  .error {
    color: var(--del);
    white-space: pre-wrap;
  }
  .output {
    margin: 0;
    max-height: 160px;
    overflow: auto;
    padding: 6px 8px;
    background: var(--sunken);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* Phone: 16px text so focusing doesn't zoom; larger targets. */
  @media (max-width: 899px) {
    textarea {
      font-size: 16px;
    }
    .primary,
    .secondary {
      height: 40px;
      font-size: 15px;
    }
  }
</style>
