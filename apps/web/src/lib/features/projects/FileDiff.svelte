<script lang="ts">
  import type { DiffFile } from "@wiki-agents/contracts/projects/model";
  import type { NumberedDiffLine } from "#lib/features/changes/diff-lines.ts";
  import { location, type ReviewComment } from "./review-message.ts";
  import { review } from "./review.svelte.ts";

  /**
   * One file's diff from HEAD with line numbers. Click (tap) a line to comment on it;
   * shift-click, or tap another line before writing, to comment on a range.
   */
  let {
    projectId,
    directory,
    file,
    lines,
    rowId,
    query,
    currentRow,
    open = $bindable(true),
    whole,
    loadingWhole,
    onwhole,
    ignored,
    ignoring,
    onignore,
  }: {
    projectId: string;
    directory: string;
    file: DiffFile;
    lines: ReadonlyArray<NumberedDiffLine>;
    /** The element id of a line, for search to scroll to. */
    rowId: (index: number) => string;
    /** Search text to mark; empty for none. */
    query: string;
    /** The line of the current search match, if it is in this file. */
    currentRow: number | null;
    open?: boolean;
    /** This is already the whole diff, as large as the server gives one file. */
    whole: boolean;
    loadingWhole: boolean;
    /** Loads the file's whole diff, for one cut short. */
    onwhole: () => void;
    /** The user set this file aside in the review (it is shown because they asked to see ignored files). */
    ignored: boolean;
    /** Ignoring or bringing back the file is in progress. */
    ignoring: boolean;
    /** Ignores the file, or brings it back when it is ignored. */
    onignore: () => void;
  } = $props();

  const LETTER = { added: "A", modified: "M", deleted: "D", renamed: "R", untracked: "U" } as const;

  /** The lines being commented on: from `anchor` to `end`, in either order. */
  let anchor = $state<number | null>(null);
  let end = $state<number | null>(null);
  let text = $state("");
  const first = $derived(anchor === null || end === null ? null : Math.min(anchor, end));
  const last = $derived(anchor === null || end === null ? null : Math.max(anchor, end));
  const selectedLines = $derived(first === null || last === null ? [] : lines.slice(first, last + 1).filter((line) => line.kind !== "hunk"));

  // A new diff for the file (a refresh) may have moved its lines: start the selection again.
  $effect(() => {
    void lines;
    anchor = null;
    end = null;
  });

  const comments = $derived(review.comments(projectId).filter((comment) => comment.directory === directory && comment.path === file.path));
  const sameLine = (a: NumberedDiffLine, b: NumberedDiffLine) => a.line === b.line && a.oldLine === b.oldLine && a.newLine === b.newLine;
  /** Each comment under the last line it quotes, while that line is still in the diff. */
  const commentsAt = $derived.by(() => {
    const at = new Map<number, Array<ReviewComment>>();
    for (const comment of comments) {
      const quoted = comment.lines.at(-1);
      const index = quoted === undefined ? -1 : lines.findIndex((line) => sameLine(line, quoted));
      if (index !== -1) at.set(index, [...(at.get(index) ?? []), comment]);
    }
    return at;
  });

  function pick(index: number, extend: boolean) {
    if (anchor !== null && (extend || text.trim() === "")) {
      // The anchor alone again: deselect.
      if (index === anchor && end === anchor && !extend) {
        anchor = null;
        end = null;
        return;
      }
      end = index;
      return;
    }
    anchor = index;
    end = index;
    text = "";
  }

  function cancel() {
    anchor = null;
    end = null;
    text = "";
  }

  function add() {
    if (text.trim() === "" || selectedLines.length === 0) return;
    review.add(projectId, { directory, path: file.path, lines: selectedLines, text: text.trim() });
    cancel();
  }

  const isSelected = (index: number) => first !== null && last !== null && index >= first && index <= last;

  /** The line's code split around search matches, case-insensitively. */
  const segments = (code: string): ReadonlyArray<{ readonly text: string; readonly match: boolean }> => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [{ text: code, match: false }];
    const parts: Array<{ text: string; match: boolean }> = [];
    const haystack = code.toLowerCase();
    let from = 0;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      if (at > from) parts.push({ text: code.slice(from, at), match: false });
      parts.push({ text: code.slice(at, at + needle.length), match: true });
      from = at + needle.length;
    }
    if (from < code.length) parts.push({ text: code.slice(from), match: false });
    return parts;
  };

  const lineLabel = (line: NumberedDiffLine) =>
    line.kind === "ins" ? `added line ${line.newLine}` : line.kind === "del" ? `removed line ${line.oldLine}` : `line ${line.newLine}`;
</script>

<section class="file" aria-label={file.path}>
  <details bind:open>
    <summary>
      <span class="status mono" data-status={file.status} title={file.status}>{LETTER[file.status]}</span>
      <span class="path mono" title={file.path}>
        {#if file.oldPath !== null}<span class="old">{file.oldPath} → </span>{/if}{file.path}
      </span>
      {#if !file.binary}<span class="counts mono"><span class="ins">+{file.additions}</span> <span class="del">−{file.deletions}</span></span>{/if}
      {#if ignored}<span class="tag">ignored</span>{/if}
      <button
        type="button"
        class="link ignore"
        disabled={ignoring}
        aria-label="{ignored ? 'Stop ignoring' : 'Ignore'} {file.path}"
        title={ignored ? "Bring the file back into the review" : "Set the file aside in this project's reviews, such as local changes you never merge"}
        onclick={(event) => {
          // Inside the summary: don't fold the file.
          event.preventDefault();
          onignore();
        }}>{ignored ? "Stop ignoring" : "Ignore"}</button
      >
    </summary>

    {#if file.binary}
      <p class="note">Binary file; no diff.</p>
    {:else if file.diff === "" && !file.truncated}
      <p class="note">No line changes (an empty file, or only its mode changed).</p>
    {:else}
      <div class="diff mono" role="group" aria-label="Diff of {file.path}">
        {#each lines as line, index (index)}
          {#if line.kind === "hunk"}
            <div class="hunk">{line.line}</div>
          {:else}
            <button
              type="button"
              class="row"
              id={rowId(index)}
              data-kind={line.kind}
              data-current={currentRow === index ? "" : undefined}
              aria-pressed={isSelected(index)}
              aria-label="{lineLabel(line)}: {line.line.slice(1)}"
              onclick={(event) => pick(index, event.shiftKey)}
            >
              <span class="num">{line.oldLine ?? ""}</span>
              <span class="num">{line.newLine ?? ""}</span>
              <span class="code"><span class="sign">{line.line[0]}</span>{#each segments(line.line.slice(1)) as part, partIndex (partIndex)}{#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
            </button>
          {/if}
          {#each commentsAt.get(index) ?? [] as comment (comment.id)}
            <div class="comment">
              <span class="where mono">{location(file.path, comment.lines)}</span>
              <p>{comment.text}</p>
              <button type="button" class="link" onclick={() => review.remove(projectId, comment.id)}>Delete</button>
            </div>
          {/each}
          {#if index === last}
            <form
              class="compose"
              onsubmit={(event) => {
                event.preventDefault();
                add();
              }}
            >
              <span class="where mono">
                {location(file.path, selectedLines)}
                {#if text.trim() === ""}<span class="hint"> · shift-click or tap another line for a range</span>{/if}
              </span>
              <!-- svelte-ignore a11y_autofocus -->
              <textarea
                aria-label="Comment"
                rows="3"
                bind:value={text}
                autofocus
                onkeydown={(event) => {
                  if (event.key === "Escape") cancel();
                  else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    add();
                  }
                }}
              ></textarea>
              <span class="buttons">
                <button type="button" class="link" onclick={cancel}>Cancel</button>
                <button type="submit" class="primary" disabled={text.trim() === ""}>Add comment</button>
              </span>
            </form>
          {/if}
        {/each}
      </div>
    {/if}
    {#if file.truncated}
      <p class="note">
        {#if whole}
          Too large to show here; review it in lazygit.
        {:else}
          Diff cut short here.
          <button type="button" class="link" disabled={loadingWhole} onclick={onwhole}>{loadingWhole ? "Loading…" : "Show the whole diff"}</button>
        {/if}
      </p>
    {/if}
  </details>
</section>

<style>
  .file {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .mono {
    font-family: var(--font-mono);
  }
  summary {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 8px 12px;
    background: var(--sunken);
    border-radius: var(--radius) var(--radius) 0 0;
    font-size: 12px;
    cursor: pointer;
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .old {
    color: var(--ink-3);
  }
  .counts {
    white-space: nowrap;
  }
  .tag {
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--ink-3);
    font-size: 11px;
  }
  .ignore {
    font-size: 12px;
    white-space: nowrap;
  }
  .ins {
    color: var(--ins);
  }
  .del {
    color: var(--del);
  }
  .status[data-status="modified"],
  .status[data-status="renamed"] {
    color: var(--agent);
  }
  .status[data-status="added"],
  .status[data-status="untracked"] {
    color: var(--ins);
  }
  .status[data-status="deleted"] {
    color: var(--del);
  }
  .note {
    margin: 0;
    padding: 10px 12px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .diff {
    font-size: 12px;
    line-height: 1.5;
    overflow-x: auto;
  }
  .hunk {
    padding: 2px 12px;
    color: var(--ink-3);
    background: var(--accent-soft);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .row {
    display: grid;
    grid-template-columns: 4ch 4ch minmax(0, 1fr);
    gap: 8px;
    width: 100%;
    padding: 0 12px 0 4px;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--sunken);
  }
  .row[data-kind="ins"] {
    background: color-mix(in srgb, var(--ins) 10%, transparent);
  }
  .row[data-kind="del"] {
    background: color-mix(in srgb, var(--del) 10%, transparent);
  }
  .row[aria-pressed="true"] {
    background: var(--agent-soft);
    box-shadow: inset 3px 0 0 var(--agent);
  }
  .row[data-current] mark {
    outline: 2px solid var(--accent);
  }
  .num {
    color: var(--ink-3);
    text-align: right;
    user-select: none;
  }
  .code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .sign {
    display: inline-block;
    width: 1.5ch;
    color: var(--ink-3);
    user-select: none;
  }
  [data-kind="ins"] .sign {
    color: var(--ins);
  }
  [data-kind="del"] .sign {
    color: var(--del);
  }
  mark {
    background: color-mix(in srgb, var(--warn) 35%, transparent);
    color: inherit;
  }
  .comment,
  .compose {
    margin: 6px 12px 8px calc(8ch + 20px);
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--agent);
    border-radius: var(--radius);
    background: var(--surface);
    font-family: var(--font-ui);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .comment p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .comment .link {
    align-self: flex-start;
  }
  .where {
    font-size: 11px;
    color: var(--ink-3);
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
    resize: vertical;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 14px;
  }
  .link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .link:disabled {
    color: var(--ink-3);
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
    opacity: 0.5;
    cursor: default;
  }

  @media (max-width: 899px) {
    .comment,
    .compose {
      margin-left: 12px;
    }
    .row {
      grid-template-columns: 3ch 3ch minmax(0, 1fr);
      gap: 6px;
    }
  }
</style>
