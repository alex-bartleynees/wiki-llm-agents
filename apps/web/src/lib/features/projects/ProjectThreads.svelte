<script lang="ts">
  import type { Project } from "@wiki-agents/contracts/projects/model";
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { openThread } from "#lib/features/threads/open-thread.svelte.ts";
  import ThreadList from "#lib/features/threads/ThreadList.svelte";
  import { threads } from "#lib/features/threads/threads.svelte.ts";
  import ThreadView from "#lib/features/threads/ThreadView.svelte";
  import { paneWidths } from "#lib/ui/layout/pane-widths.svelte.ts";
  import PaneSplitter from "#lib/ui/layout/PaneSplitter.svelte";
  import ArchivedNotice from "./ArchivedNotice.svelte";
  import ProjectDetails from "./ProjectDetails.svelte";
  import ProjectViewSwitch from "./ProjectViewSwitch.svelte";
  import { projects } from "./projects.svelte.ts";

  /**
   * A project's threads with the open one in the middle and the project beside it.
   * Only the project's own threads: vault threads stay in the wiki.
   */
  let { project }: { project: Project } = $props();

  // The same thread list as the wiki's, narrowed to this project; it reopens the
  // thread last open in the project.
  $effect(() => {
    const scope = { vaultId: project.vaultId, projectId: project.id };
    untrack(() => void threads.connect(scope));
  });

  const open = $derived(openThread.status !== "empty");
</script>

<div
  class="layout"
  class:open
  style:--list-width="{paneWidths.widths.projectThreads}px"
  style:--details-width="{paneWidths.widths.projectDetails}px"
>
  <aside class="list" aria-label="Threads in {project.name}">
    <div class="top">
      <ProjectViewSwitch projectId={project.id} view="threads" />
      <label>
        <span class="label mono">project</span>
        <select value={project.id} onchange={(event) => goto(`/projects/${event.currentTarget.value}/threads`)}>
          {#each projects.active as other (other.id)}
            <option value={other.id}>{other.name}</option>
          {/each}
          {#if project.archivedAt !== null}
            <option value={project.id}>{project.name} (archived)</option>
          {/if}
        </select>
      </label>
      {#if project.archivedAt !== null}
        <ArchivedNotice {project} />
      {/if}
    </div>
    <ThreadList vaultId={project.vaultId} projectId={project.id} scopeSelect={false} />
    <details class="phone-details">
      <summary>Project details</summary>
      <ProjectDetails {project} />
    </details>
  </aside>
  <PaneSplitter pane="projectThreads" label="Resize threads sidebar" edge="start" />

  <main class="thread">
    {#if open}
      <ThreadView />
    {:else}
      <div class="empty">
        <p>Open a thread on the left, or start one with <strong>New thread</strong>.</p>
        <p class="muted">Threads here work in {project.workingDirectories[0]} and use the shared vault for notes.</p>
      </div>
    {/if}
  </main>

  <div class="details-splitter">
    <PaneSplitter pane="projectDetails" label="Resize project sidebar" edge="end" />
  </div>
  <aside class="details" aria-label="Project">
    <ProjectDetails {project} />
  </aside>
</div>

<style>
  .layout {
    height: 100%;
    display: flex;
    min-height: 0;
  }
  /* Sidebars take the splitters' widths and shrink before the thread goes below 400px. */
  .list {
    flex: 0 1 var(--list-width);
    min-width: 220px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
    overflow: auto;
  }
  .top {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 16px 4px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-3);
  }
  select {
    height: 36px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }
  .thread {
    flex: 1 1 0;
    min-width: 400px;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }
  .empty {
    margin: auto;
    max-width: 420px;
    padding: 24px;
    text-align: center;
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--ink-3);
    font-size: 13px;
  }
  .details-splitter {
    display: contents;
  }
  .details {
    flex: 0 1 var(--details-width);
    min-width: 260px;
    box-sizing: border-box;
    padding: 20px;
    border-left: 1px solid var(--line);
    overflow: auto;
  }
  .phone-details {
    display: none;
  }

  /* Narrower desktops: the project panel gives way to the thread. */
  @media (max-width: 1199px) {
    .details,
    .details-splitter {
      display: none;
    }
    .phone-details {
      display: block;
      margin-top: auto;
      padding: 12px 16px 16px;
      border-top: 1px solid var(--line-soft);
    }
    .phone-details summary {
      cursor: pointer;
      color: var(--ink-2);
      font-size: 13px;
    }
    .phone-details :global(.details) {
      margin-top: 14px;
    }
  }

  /* Phone: the list, or the open thread, one at a time. */
  @media (max-width: 899px) {
    .list {
      flex: 1 1 auto;
      min-width: 0;
      border: 0;
    }
    .layout > :global(.splitter) {
      display: none;
    }
    .thread {
      display: none;
      min-width: 0;
    }
    .open .list {
      display: none;
    }
    .open .thread {
      display: flex;
      flex: 1 1 auto;
    }
  }
</style>
