<script lang="ts">
  import type { Project } from "@wiki-agents/contracts/projects/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import Button from "#lib/ui/primitives/Button.svelte";
  import FolderPicker from "#lib/ui/primitives/FolderPicker.svelte";
  import { projects } from "./projects.svelte.ts";

  let { project, compact = false }: { project: Project; compact?: boolean } = $props();

  let picking = $state(false);
  let changing = $state(false);
  let error = $state<string | null>(null);

  async function change(action: () => Promise<void>, fallback: string) {
    changing = true;
    error = null;
    try {
      await action();
    } catch (cause) {
      error = errorMessage(cause, fallback);
    } finally {
      changing = false;
    }
  }
  const add = (path: string) => change(() => projects.addDirectory(project.id, path), "Could not add the directory");
  const remove = (path: string) => change(() => projects.removeDirectory(project.id, path), "Could not remove the directory");
</script>

<section aria-label="Working directories" class:compact>
  <svelte:element this={compact ? "h3" : "h2"} class="mono heading">working directories</svelte:element>
  {#each project.workingDirectories as directory, index (directory)}
    <div class="entry">
      <span class="path mono">{directory}</span>
      <span class="entry-line">
        <span class="meta mono">
          {#if index === 0}<span class="main">main · threads start here</span> ·{/if}
          agents may write
        </span>
        {#if index > 0}
          <button type="button" class="link" aria-label="Remove {directory}" disabled={changing} onclick={() => remove(directory)}>Remove</button>
        {/if}
      </span>
    </div>
  {/each}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <Button class="add" disabled={changing} onclick={() => (picking = true)}>
    {changing ? "Updating…" : "Add directory…"}
  </Button>
  <p class="note">Adding or removing a directory reaches running threads from their next turn. Removing one leaves its files on disk.</p>
  <FolderPicker bind:open={picking} title="Add a working directory" load={machineFolders} onchoose={add} typed />
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .heading {
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
  .compact .entry {
    padding: 6px 0;
  }
  .entry + .entry {
    border-top: 1px solid var(--line-soft);
  }
  .path {
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .compact .path {
    font-size: 12px;
  }
  .meta {
    font-size: 11px;
    color: var(--ink-3);
  }
  .main {
    color: var(--accent-ink);
  }
  .entry-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 10px;
    row-gap: 2px;
    min-width: 0;
  }
  .link {
    flex: 0 0 auto;
    margin-left: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
  }
  .link:hover {
    color: var(--ink);
  }
  section :global(.add) {
    align-self: flex-start;
    margin-top: 4px;
  }
  .note {
    margin: 8px 0 0;
    padding: 8px 10px;
    background: var(--sunken);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--ink-2);
  }
  .compact .note {
    font-size: 12px;
  }
  .error {
    margin: 6px 0 0;
    color: var(--del);
  }
  @media (max-width: 899px) {
    section :global(.add),
    .link {
      min-height: 44px;
    }
  }
</style>
