<script lang="ts">
  import type { Project } from "@wiki-agents/contracts/projects/model";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import ChangedFiles from "./ChangedFiles.svelte";

  /** The project beside its threads: folders, vault and changed files. */
  let { project }: { project: Project } = $props();

  const vault = $derived(vaults.byId(project.vaultId));
</script>

<div class="details">
  <div>
    <div class="label mono">project</div>
    <h2>{project.name}</h2>
    <a href="/projects/{project.id}">Overview</a>
  </div>

  <section aria-label="Working directories">
    <h3 class="mono">working directories</h3>
    {#each project.workingDirectories as directory, index (directory)}
      <p class="path mono">{directory}{#if index === 0}<span class="main"> · main</span>{/if}</p>
    {/each}
  </section>

  <section aria-label="Shared vault">
    <h3 class="mono">shared vault</h3>
    <p><a href="/vaults/{project.vaultId}">{vault?.name ?? "vault"}</a>{#if project.notesFolder !== null}<span class="mono muted"> · {project.notesFolder}</span>{/if}</p>
  </section>

  <ChangedFiles {project} />
</div>

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: 22px;
    font-size: 13px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .label,
  h3 {
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-3);
  }
  h2 {
    margin: 2px 0 4px;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  h3 {
    margin: 0 0 6px;
  }
  p {
    margin: 0 0 6px;
  }
  .path {
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .main {
    color: var(--accent-ink);
  }
  .muted {
    font-size: 12px;
    color: var(--ink-3);
  }
  a {
    color: var(--accent-ink);
    text-decoration: none;
  }
  a:hover {
    color: var(--ink);
  }
</style>
