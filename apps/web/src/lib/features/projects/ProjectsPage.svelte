<script lang="ts">
  import type { Project } from "@wiki-agents/contracts/projects/model";
  import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { errorMessage } from "#lib/api/client.ts";
  import { agents } from "#lib/features/agents/agents.svelte.ts";
  import { timeAgo } from "#lib/features/notes/time.ts";
  import { listThreads } from "#lib/features/threads/api.ts";
  import { byRecent, doneThreads, openThreads } from "#lib/features/threads/thread-order.ts";
  import { threads } from "#lib/features/threads/threads.svelte.ts";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import { paneWidths } from "#lib/ui/layout/pane-widths.svelte.ts";
  import PaneSplitter from "#lib/ui/layout/PaneSplitter.svelte";
  import ArchivedNotice from "./ArchivedNotice.svelte";
  import ChangedFiles from "./ChangedFiles.svelte";
  import DiffReview from "./DiffReview.svelte";
  import ProjectThreads from "./ProjectThreads.svelte";
  import ProjectViewSwitch from "./ProjectViewSwitch.svelte";
  import { projects } from "./projects.svelte.ts";
  import RegisterProjectForm from "./RegisterProjectForm.svelte";

  /**
   * The project to show (null: the first active one), as an overview with the project in the
   * middle, with its threads in the middle, or with its diff from git for review.
   */
  let { projectId, view = "overview" }: { projectId: string | null; view?: "overview" | "threads" | "diff" } = $props();

  let loaded = $state(false);
  let error = $state<string | null>(null);
  /** Every thread of the projects' vaults, by project. */
  let projectThreads = $state<ReadonlyMap<string, ReadonlyArray<ThreadSummary>>>(new Map());

  const selected = $derived(projectId === null ? (projects.active[0] ?? null) : (projects.list.find((project) => project.id === projectId) ?? null));
  const selectedThreads = $derived(selected === null ? [] : (projectThreads.get(selected.id) ?? []));
  /** The project's threads not marked done, most recently updated first. */
  const selectedOpen = $derived(openThreads([...selectedThreads].sort(byRecent)));
  /** The project's done threads, collapsed under "done · n". */
  const selectedDone = $derived(doneThreads(selectedThreads));
  const vault = $derived(selected === null ? undefined : vaults.byId(selected.vaultId));
  /** The shared vault new projects use: the one existing projects use, or the only vault. */
  const sharedVault = $derived(vaults.byId(projects.list[0]?.vaultId) ?? (vaults.list.length === 1 ? vaults.list[0] : undefined));

  $effect(() => {
    untrack(() => {
      void Promise.all([projects.load(), vaults.load(), agents.load()]).then(() => (loaded = true));
    });
  });

  // One request per vault for every project's threads (status and counts).
  $effect(() => {
    const vaultIds = [...new Set(projects.list.map((project) => project.vaultId))];
    untrack(() => void loadThreads(vaultIds));
  });

  async function loadThreads(vaultIds: ReadonlyArray<string>) {
    try {
      const lists = await Promise.all(vaultIds.map((vaultId) => listThreads(vaultId, null)));
      const byProject = new Map<string, Array<ThreadSummary>>();
      for (const thread of lists.flatMap((list) => list.threads)) {
        if (thread.projectId === null) continue;
        byProject.set(thread.projectId, [...(byProject.get(thread.projectId) ?? []), thread]);
      }
      projectThreads = byProject;
    } catch (cause) {
      error = errorMessage(cause, "Could not load the projects' threads");
    }
  }

  const busyCount = (project: Project) => (projectThreads.get(project.id) ?? []).filter((thread) => thread.status !== "idle").length;
  const summary = (project: Project) => {
    const dirs = project.workingDirectories.length;
    const busy = busyCount(project);
    return `${dirs} ${dirs === 1 ? "dir" : "dirs"} · 1 vault${busy === 0 ? "" : ` · ${busy} running`}`;
  };
  const folderName = (directory: string) => directory.split("/").filter(Boolean).at(-1) ?? directory;

  /** Opens a thread of the project (a new one for null) in the Threads view. */
  async function openThreadOf(project: Project, threadId: string | null) {
    error = null;
    const scope = { vaultId: project.vaultId, projectId: project.id };
    try {
      if (threadId === null) await threads.startIn(scope);
      else await threads.show(scope, threadId);
    } catch (cause) {
      error = errorMessage(cause, "Could not start a thread");
      return;
    }
    await goto(`/projects/${project.id}/threads`);
  }

  const focusForm = () => document.getElementById("project-name")?.focus();

  let archiving = $state(false);
  /** Archives the project and stays on it, so Restore is one click away. */
  async function archive(project: Project) {
    archiving = true;
    error = null;
    try {
      await projects.archive(project.id);
    } catch (cause) {
      error = errorMessage(cause, "Could not archive the project");
    } finally {
      archiving = false;
    }
  }
</script>

<svelte:head>
  <title>{selected === null ? "Projects" : `${selected.name} · Projects`} · wiki-agents</title>
</svelte:head>

{#if view === "threads" || view === "diff"}
  {#if selected !== null}
    {#if view === "threads"}<ProjectThreads project={selected} />{:else}<DiffReview project={selected} />{/if}
  {:else if loaded}
    <div class="missing">
      <h1>Project not found</h1>
      <p class="lede">It may have been removed. <a href="/projects">Show all projects</a></p>
    </div>
  {/if}
{:else}
<div
  class="layout"
  style:--list-width="{paneWidths.widths.projectList}px"
  style:--register-width="{paneWidths.widths.registerProject}px"
>
  <aside class="list" aria-label="Projects">
    {#if selected !== null}
      <div class="switch"><ProjectViewSwitch projectId={selected.id} view="overview" /></div>
    {/if}
    <div class="label mono">projects</div>
    {#each projects.active as project (project.id)}
      <a href="/projects/{project.id}" aria-current={project.id === selected?.id ? "page" : undefined}>
        <span>{project.name}</span>
        <span class="meta mono">{summary(project)}</span>
      </a>
    {/each}
    {#if projects.archived.length > 0}
      <details class="archived" open={selected?.archivedAt != null}>
        <summary class="mono">archived · {projects.archived.length}</summary>
        {#each projects.archived as project (project.id)}
          <a href="/projects/{project.id}" aria-current={project.id === selected?.id ? "page" : undefined}>
            <span>{project.name}</span>
            <span class="meta mono">{summary(project)}</span>
          </a>
        {/each}
      </details>
    {/if}
    <button type="button" class="secondary" onclick={focusForm}>Register project</button>
  </aside>
  <PaneSplitter pane="projectList" label="Resize projects sidebar" edge="start" />

  <main>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if projects.error}<p class="error" role="alert">{projects.error}</p>{/if}

    {#if selected !== null}
      <div class="title">
        <div>
          <div class="label mono">{selected.archivedAt === null ? "project" : "archived project"}</div>
          <h1>{selected.name}</h1>
          <p class="lede">
            {#if selected.notesFolder !== null}
              Notes live in <a href="/vaults/{selected.vaultId}">{selected.notesFolder}</a>.
            {:else}
              Notes come from the shared vault{vault ? `, ${vault.name}` : ""}.
            {/if}
          </p>
        </div>
        {#if selected.archivedAt === null}
          <div class="actions">
            <button type="button" class="secondary" disabled={archiving} onclick={() => archive(selected)}>Archive</button>
            <button type="button" class="primary" onclick={() => openThreadOf(selected, null)}>New thread here</button>
          </div>
        {/if}
      </div>
      {#if selected.archivedAt !== null}
        <ArchivedNotice project={selected} />
      {/if}

      <div class="columns">
        <section aria-label="Working directories">
          <h2 class="mono">working directories</h2>
          {#each selected.workingDirectories as directory, index (directory)}
            <div class="entry">
              <span class="path mono">{directory}</span>
              <span class="meta mono">
                {#if index === 0}<span class="main">main · threads start here</span> ·{/if}
                agents may write
              </span>
            </div>
          {/each}
        </section>
        <section aria-label="Shared vault">
          <h2 class="mono">shared vault</h2>
          <div class="entry">
            <span class="vault-name">{vault?.name ?? "vault"} <span class="mono">{vault?.rootPath ?? ""}</span></span>
            <span class="meta mono">
              reached through the vault MCP server and rules{selected.notesFolder === null ? "" : ` · notes folder ${selected.notesFolder}`}
            </span>
          </div>
          <p class="note">
            Agents work in these directories and the shared vault as their autonomy allows. Going anywhere else needs your
            approval. Commands follow each agent's autonomy settings.
          </p>
        </section>
      </div>

      <section aria-label="Threads">
        <h2 class="mono">
          threads in this project · {selectedThreads.length === 0 ? "0" : `${selectedOpen.length} open · ${selectedDone.length} done`}
        </h2>
        {#if selectedThreads.length === 0}
          <p class="muted">No threads yet.{#if selected.archivedAt === null} Start one with <strong>New thread here</strong>.{/if}</p>
        {:else}
          {#if selectedOpen.length === 0}
            <p class="muted all-done">Every thread here is done.</p>
          {/if}
          <div role="list" aria-label="Open project threads">
            {#each selectedOpen as thread (thread.id)}
              {@render threadRow(selected, thread)}
            {/each}
          </div>
          {#if selectedDone.length > 0}
            <details class="done">
              <summary class="mono">done · {selectedDone.length}</summary>
              <div role="list" aria-label="Done project threads">
                {#each selectedDone as thread (thread.id)}
                  {@render threadRow(selected, thread)}
                {/each}
              </div>
            </details>
          {/if}
        {/if}
      </section>

      <ChangedFiles project={selected} />
    {:else if loaded && projectId !== null}
      <h1>Project not found</h1>
      <p class="lede">It may have been removed. <a href="/projects">Show all projects</a></p>
    {:else if loaded && projects.list.length > 0}
      <h1>No active projects</h1>
      <p class="lede">Every project is archived. Open one under <strong>archived</strong> to restore it, or register a new one.</p>
    {:else if loaded}
      <h1>No projects yet</h1>
      <p class="lede">
        A project has its own folders and threads, and its agents use the shared vault's notes. Register one to start.
      </p>
    {/if}
  </main>

  <PaneSplitter pane="registerProject" label="Resize register project sidebar" edge="end" />
  <aside class="register" aria-label="Register project">
    <RegisterProjectForm
      vault={sharedVault ?? null}
      vaultLabel={vaults.list.length > 1 ? "The vault registered first" : null}
      onregistered={async (project) => {
        await projects.load();
        await goto(`/projects/${project.id}`);
      }}
    />
  </aside>
</div>
{/if}

{#snippet threadRow(project: Project, thread: ThreadSummary)}
  <div class="thread" role="listitem">
    <span class="thread-title">{thread.title ?? "New thread"}</span>
    <span class="mono agent">{thread.agentId === null ? "" : (agents.get(thread.agentId)?.name ?? thread.agentId)}</span>
    <span class="mono muted cwd">cwd {folderName(project.workingDirectories[0] ?? "")}</span>
    <span class="mono status" data-status={thread.status}>
      {thread.status === "running" ? "● running" : thread.status === "waiting" ? "▲ needs you" : thread.doneAt !== null ? `✓ done ${timeAgo(thread.doneAt)}` : timeAgo(thread.updatedAt)}
    </span>
    <button type="button" class="link" onclick={() => openThreadOf(project, thread.id)}>Open</button>
  </div>
{/snippet}

<style>
  .missing {
    padding: 28px 40px;
  }
  /*
   * Desktop: three columns. The sidebars take the splitters' widths and shrink
   * (down to their minimum) before the project goes below 400px.
   */
  .layout {
    min-height: 100%;
    display: flex;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .label {
    font-size: 12px;
    color: var(--ink-3);
  }
  .meta {
    font-size: 11px;
    color: var(--ink-3);
  }
  .muted {
    color: var(--ink-3);
  }
  a {
    color: var(--accent-ink);
  }

  /* Projects list */
  .list {
    flex: 0 1 var(--list-width);
    min-width: 180px;
    box-sizing: border-box;
    padding: 18px 12px;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    font-size: 14px;
  }
  .list .switch {
    padding: 0 0 16px;
  }
  .list .label {
    padding: 0 8px 8px;
  }
  .list a {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
    border-radius: 3px;
    color: var(--ink);
    text-decoration: none;
  }
  .list a:hover {
    background: var(--sunken);
  }
  .list a[aria-current="page"] {
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .list a[aria-current="page"] .meta {
    font-weight: 400;
  }
  .archived {
    margin-top: 12px;
  }
  .archived summary {
    padding: 4px 8px;
    font-size: 12px;
    color: var(--ink-3);
    cursor: pointer;
  }
  .list > .secondary {
    margin-top: 16px;
  }
  .secondary {
    height: 36px;
    padding: 0 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  /* The project */
  main {
    flex: 1 1 0;
    min-width: 400px;
    box-sizing: border-box;
    padding: 28px 40px 56px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 36px;
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 16px;
  }
  .title .label {
    margin-bottom: 6px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.025em;
  }
  .lede {
    margin: 6px 0 0;
    font-size: 15px;
    color: var(--ink-2);
  }
  .lede a {
    text-decoration: none;
  }
  .actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
  .primary {
    height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
    gap: 32px;
  }
  section {
    display: flex;
    flex-direction: column;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-3);
  }
  .entry {
    padding: 11px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .entry + .entry {
    border-top: 1px solid var(--line-soft);
  }
  .path {
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .main {
    color: var(--accent-ink);
  }
  .vault-name {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .vault-name .mono {
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-3);
  }
  .note {
    margin: 8px 0 0;
    padding: 8px 10px;
    background: var(--sunken);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--ink-2);
  }
  .thread {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px 150px 120px 70px;
    gap: 14px;
    align-items: center;
    padding: 11px 0;
    border-bottom: 1px solid var(--line-soft);
    font-size: 14px;
  }
  .all-done {
    margin: 8px 0;
    font-size: 13px;
  }
  .done summary {
    padding: 11px 0;
    border-bottom: 1px solid var(--line-soft);
    font-size: 12px;
    color: var(--ink-3);
    cursor: pointer;
  }
  .done .thread-title {
    color: var(--ink-2);
  }
  .thread-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .thread .mono {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent {
    color: var(--agent);
  }
  .status {
    color: var(--ink-3);
  }
  .status[data-status="running"] {
    color: var(--ok);
  }
  .status[data-status="waiting"] {
    color: var(--agent);
  }
  .link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .link:hover {
    color: var(--ink);
  }
  .error {
    margin: 0;
    color: var(--del);
  }

  /* Register form */
  .register {
    flex: 0 1 var(--register-width);
    min-width: 280px;
    box-sizing: border-box;
    padding: 24px 20px;
    border-left: 1px solid var(--line);
  }

  /* Phone: one column, list first, form last. */
  @media (max-width: 899px) {
    .layout {
      flex-wrap: wrap;
    }
    .layout > :global(.splitter) {
      display: none;
    }
    .list,
    .register {
      flex-basis: 100%;
      max-width: none;
      min-width: 0;
      border: 0;
    }
    .list {
      border-bottom: 1px solid var(--line);
    }
    .register {
      border-top: 1px solid var(--line);
    }
    main {
      flex-basis: 100%;
      min-width: 0;
      padding: 20px 16px 32px;
      gap: 28px;
    }
    .actions {
      margin-left: 0;
    }
    .thread {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 4px 12px;
    }
    .thread .agent,
    .thread .cwd {
      display: none;
    }
    .thread .link {
      grid-column: 2;
      grid-row: 1;
    }
    .thread .status {
      grid-column: 1;
    }
  }
</style>
