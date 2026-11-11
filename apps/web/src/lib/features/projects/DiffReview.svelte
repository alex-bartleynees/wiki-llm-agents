<script lang="ts">
  import type { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
  import type { DiffFile, Project } from "@wiki-agents/contracts/projects/model";
  import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
  import type { ThreadStatus } from "@wiki-agents/contracts/threads/model";
  import { tick, untrack } from "svelte";
  import { errorMessage } from "#lib/api/client.ts";
  import { listen } from "#lib/api/sse.ts";
  import { numberedDiffLines } from "#lib/features/changes/diff-lines.ts";
  import { vaultThreadsEventsPath } from "#lib/features/threads/api.ts";
  import { getDiff, getFileDiff } from "./api.ts";
  import FileDiff from "./FileDiff.svelte";
  import ProjectViewSwitch from "./ProjectViewSwitch.svelte";
  import ReviewPanel from "./ReviewPanel.svelte";
  import { review } from "./review.svelte.ts";

  /**
   * The project's changes from git, compared with HEAD, for review: every changed file
   * with its diff, search, and line comments sent to a thread. Refreshes when one of
   * the project's turns ends. Desktop: the file list beside every diff; phone: the
   * list, then one file at a time.
   */
  let { project }: { project: Project } = $props();

  const LETTER = { added: "A", modified: "M", deleted: "D", renamed: "R", untracked: "U" } as const;
  const CHANGE_LETTER = { created: "A", modified: "M", deleted: "D" } as const;

  let diff = $state<GetDiffResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  /** Files replaced by their whole diff, by key, until the next refresh. */
  let whole = $state<Record<string, DiffFile>>({});
  let loadingWhole = $state<ReadonlySet<string>>(new Set());
  let collapsed = $state<ReadonlySet<string>>(new Set());
  /** The file shown on a phone; null shows the list. */
  let openKey = $state<string | null>(null);
  let query = $state("");
  let current = $state(0);
  /** Bumped when one of the project's threads changes, so the thread chooser reloads. */
  let threadsVersion = $state(0);
  let searchInput = $state<HTMLInputElement>();

  const keyOf = (directory: string, path: string) => `${directory}\0${path}`;
  const folderName = (directory: string) => directory.split("/").filter(Boolean).at(-1) ?? directory;

  /** Every git file, numbered once, in display order. */
  const entries = $derived(
    (diff?.directories ?? []).flatMap((directory) =>
      directory.files.map((listed) => {
        const key = keyOf(directory.directory, listed.path);
        const file = whole[key] ?? listed;
        return { key, directory: directory.directory, file, whole: key in whole, lines: numberedDiffLines(file.diff) };
      }),
    ),
  );
  const indexOf = $derived(new Map(entries.map((entry, index) => [entry.key, index])));
  const totals = $derived({
    files: entries.length,
    additions: entries.reduce((sum, entry) => sum + entry.file.additions, 0),
    deletions: entries.reduce((sum, entry) => sum + entry.file.deletions, 0),
  });
  const comments = $derived(review.comments(project.id));

  /** Search matches, one per matching line, in display order. */
  const matches = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [];
    const found: Array<{ readonly key: string; readonly index: number }> = [];
    for (const entry of entries) {
      entry.lines.forEach((line, index) => {
        if (line.kind !== "hunk" && line.line.slice(1).toLowerCase().includes(needle)) found.push({ key: entry.key, index });
      });
    }
    return found;
  });
  const currentMatch = $derived(matches[current] ?? null);

  const rowId = (key: string, index: number) => `diff-${indexOf.get(key) ?? 0}-${index}`;

  async function load() {
    const id = project.id;
    loading = true;
    try {
      const result = await getDiff(id);
      if (project.id !== id) return;
      diff = result;
      whole = {};
      error = null;
    } catch (cause) {
      if (project.id === id) error = errorMessage(cause, "Could not read the changes");
    } finally {
      loading = false;
    }
  }

  async function loadWhole(entry: (typeof entries)[number]) {
    loadingWhole = new Set([...loadingWhole, entry.key]);
    try {
      const { file } = await getFileDiff(project.id, entry.directory, entry.file.path);
      whole = { ...whole, [entry.key]: file };
    } catch (cause) {
      error = errorMessage(cause, "Could not load the whole diff");
    } finally {
      loadingWhole = new Set([...loadingWhole].filter((key) => key !== entry.key));
    }
  }

  // Loaded for each project shown, and again when one of its turns ends.
  $effect(() => {
    const { id, vaultId } = project;
    untrack(() => {
      diff = null;
      openKey = null;
      collapsed = new Set();
      void load();
    });
    const statuses = new Map<string, ThreadStatus>();
    return listen(vaultThreadsEventsPath(vaultId), ThreadsStreamMessage, {
      onEvent: (message) => {
        if (message.type !== "thread.updated" || message.thread.projectId !== id) return;
        const before = statuses.get(message.thread.id);
        statuses.set(message.thread.id, message.thread.status);
        threadsVersion += 1;
        if (before !== undefined && before !== "idle" && message.thread.status === "idle") void load();
      },
      onReconnect: () => void load(),
    });
  });

  async function show(key: string, index: number | null) {
    openKey = key;
    collapsed = new Set([...collapsed].filter((other) => other !== key));
    await tick();
    const target = index === null ? document.getElementById(`file-${indexOf.get(key) ?? 0}`) : document.getElementById(rowId(key, index));
    target?.scrollIntoView({ block: index === null ? "start" : "center" });
  }

  function step(by: number) {
    if (matches.length === 0) return;
    current = (current + by + matches.length) % matches.length;
    const match = matches[current]!;
    void show(match.key, match.index);
  }

  // A new search starts at its first match.
  $effect(() => {
    void query;
    untrack(() => {
      current = 0;
      if (matches.length > 0) void show(matches[0]!.key, matches[0]!.index);
    });
  });

  const typing = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
    if (event.key === "/") {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (event.key === "n" || event.key === "N") {
      if (matches.length === 0) return;
      event.preventDefault();
      step(event.key === "n" ? 1 : -1);
    }
  }

  function setOpen(key: string, value: boolean) {
    collapsed = value ? new Set([...collapsed].filter((other) => other !== key)) : new Set([...collapsed, key]);
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="layout" class:file-open={openKey !== null}>
  <aside class="side" aria-label="Changed files in {project.name}">
    <ProjectViewSwitch projectId={project.id} view="diff" />
    <ReviewPanel {project} {threadsVersion} />
    <nav class="files" aria-label="Files">
      {#if diff !== null}
        {#each diff.directories as directory (directory.directory)}
          <div class="folder mono" title={directory.directory}>
            {folderName(directory.directory)} · {directory.git ? directory.files.length : directory.changes.length}
            {(directory.git ? directory.files.length : directory.changes.length) === 1 ? "file" : "files"}
          </div>
          {#if directory.git}
            {#each directory.files as file (file.path)}
              {@const key = keyOf(directory.directory, file.path)}
              <button type="button" class="entry mono" aria-current={openKey === key ? "true" : undefined} onclick={() => show(key, null)}>
                <span class="status" data-status={file.status} title={file.status}>{LETTER[file.status]}</span>
                <span class="path" title={file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`}>{file.path}</span>
                <span class="counts">
                  {#if file.binary}bin{:else}<span class="ins">+{file.additions}</span> <span class="del">−{file.deletions}</span>{/if}
                </span>
              </button>
            {:else}
              <p class="none">No changes from HEAD.</p>
            {/each}
          {:else}
            <p class="none">Not a git repository: no diff. These files changed since the project was registered or last reviewed.</p>
            {#each directory.changes as change (change.path)}
              <div class="entry plain mono">
                <span class="status" data-status={change.status}>{CHANGE_LETTER[change.status]}</span>
                <span class="path" title={change.path}>{change.path}</span>
              </div>
            {/each}
          {/if}
        {/each}
      {/if}
    </nav>
  </aside>

  <main class="diffs" aria-label="Diff">
    <div class="toolbar">
      <button type="button" class="back" onclick={() => (openKey = null)}>
        ‹ All files{comments.length === 0 ? "" : ` · ${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
      </button>
      <div class="summary">
        <h1>Changes in {project.name}</h1>
        <p class="lede">
          {#if diff !== null}
            <span class="mono">{totals.files} {totals.files === 1 ? "file" : "files"} · <span class="ins">+{totals.additions}</span> <span class="del">−{totals.deletions}</span></span> ·
          {/if}
          Compared with HEAD: staged and unstaged changes together, untracked files as new. The overview's changed-file list compares with
          your last review instead. Undo in lazygit.
        </p>
      </div>
      <div class="tools">
        <input
          bind:this={searchInput}
          bind:value={query}
          type="search"
          placeholder="Search the diff  /"
          aria-label="Search the diff"
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              searchInput?.blur();
            }
          }}
        />
        {#if query.trim() !== ""}
          <span class="mono count" aria-live="polite">{matches.length === 0 ? "no matches" : `${current + 1} of ${matches.length}`}</span>
          <button type="button" class="link" aria-label="Previous match" disabled={matches.length === 0} onclick={() => step(-1)}>↑</button>
          <button type="button" class="link" aria-label="Next match" disabled={matches.length === 0} onclick={() => step(1)}>↓</button>
        {/if}
        <button type="button" class="link" onclick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    {#if diff === null}
      {#if loading}<p class="muted">Reading the changes…</p>{/if}
    {:else if entries.length === 0}
      <p class="muted">No changes from HEAD{diff.directories.some((directory) => !directory.git) ? " in the git working directories" : ""}.</p>
    {:else}
      {#each entries as entry, index (entry.key)}
        <div id="file-{index}" class="slot" class:current={openKey === entry.key}>
          {#if index === 0 || entries[index - 1]!.directory !== entry.directory}
            {#if diff.directories.length > 1}<div class="folder-head mono" title={entry.directory}>{folderName(entry.directory)}</div>{/if}
          {/if}
          <FileDiff
            projectId={project.id}
            directory={entry.directory}
            file={entry.file}
            lines={entry.lines}
            rowId={(row) => rowId(entry.key, row)}
            {query}
            currentRow={currentMatch?.key === entry.key ? currentMatch.index : null}
            bind:open={() => !collapsed.has(entry.key), (value) => setOpen(entry.key, value)}
            whole={entry.whole}
            loadingWhole={loadingWhole.has(entry.key)}
            onwhole={() => loadWhole(entry)}
          />
        </div>
      {/each}
    {/if}
  </main>
</div>

<style>
  .layout {
    height: 100%;
    display: flex;
    min-height: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .side {
    flex: 0 0 300px;
    min-width: 0;
    box-sizing: border-box;
    padding: 16px;
    border-right: 1px solid var(--line);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .files {
    display: flex;
    flex-direction: column;
  }
  .folder {
    padding: 6px 0;
    font-size: 12px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .entry {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: baseline;
    padding: 5px 6px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--ink);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .entry.plain {
    cursor: default;
  }
  .entry:hover:not(.plain),
  .entry[aria-current="true"] {
    background: var(--sunken);
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .counts {
    white-space: nowrap;
    color: var(--ink-3);
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
  .status[data-status="untracked"],
  .status[data-status="created"] {
    color: var(--ins);
  }
  .status[data-status="deleted"] {
    color: var(--del);
  }
  .none {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--ink-3);
  }

  .diffs {
    flex: 1 1 0;
    min-width: 0;
    box-sizing: border-box;
    padding: 20px 28px 48px;
    overflow: auto;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 20px;
  }
  .summary {
    flex: 1 1 420px;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .lede {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--ink-2);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  input[type="search"] {
    width: 220px;
    height: 32px;
    box-sizing: border-box;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
  }
  .count {
    font-size: 12px;
    color: var(--ink-3);
    white-space: nowrap;
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
    cursor: default;
  }
  .back {
    display: none;
  }
  .folder-head {
    margin: 8px 0 6px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .muted {
    color: var(--ink-3);
  }
  .error {
    margin: 0;
    color: var(--del);
  }

  /* Phone: the list, or one file. */
  @media (max-width: 899px) {
    .layout {
      flex-direction: column;
    }
    .side {
      flex: 1 1 auto;
      border: 0;
    }
    .diffs {
      display: none;
      padding: 12px 12px 32px;
    }
    .file-open .side {
      display: none;
    }
    .file-open .diffs {
      display: flex;
      flex: 1 1 auto;
    }
    .slot:not(.current) {
      display: none;
    }
    .back {
      display: block;
      flex-basis: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--accent-ink);
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }
    .summary {
      display: none;
    }
    .tools {
      flex: 1 1 100%;
      flex-wrap: wrap;
    }
    input[type="search"] {
      flex: 1 1 140px;
      width: auto;
    }
  }
</style>
