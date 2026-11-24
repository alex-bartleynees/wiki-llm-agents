<script lang="ts">
  import type { InstallAction, InstallTarget } from "@wiki-agents/contracts/skills/model";
  import { installLabels } from "./install-labels.ts";

  let { targets, busy, editing, recover, prepare, openSettings }: {
    targets: ReadonlyArray<InstallTarget>;
    busy: boolean;
    editing: boolean;
    recover: (destination: string) => void;
    prepare: (action: InstallAction, destination: string) => void;
    openSettings: () => void;
  } = $props();
  let section: HTMLElement;

  const differenceLabels = {
    content: "Content differs",
    permissions: "Permissions differ",
    "entry type": "File or directory type differs",
    "only installed": "Only in the installed copy",
    "only library": "Only in the library",
  } as const;

  export function reveal() {
    section.scrollIntoView({ block: "start" });
    section.focus({ preventScroll: true });
  }
</script>

<section class="card installations" aria-label="Install destinations" tabindex="-1" class:empty-installs={!targets.length} bind:this={section}>
  <h3>Install destinations</h3>
  {#each targets as target (target.path)}
    <div class="target">
      <strong>{target.destination.labels.join(" · ")}</strong>
      <code>{target.path}</code>
      <span class="install-status" data-status={target.status}>{installLabels[target.status]}</span>
      {#if target.status === "external installed" || target.status === "external differs"}<p>Managed outside wiki-agents</p>{/if}
      {#if target.differences?.length}
        <div class="install-differences" role="group" aria-label="Differences from library">
          <strong>Differences from library</strong>
          <ul>
            {#each target.differences as difference (difference.path)}
              <li><code>{difference.path}</code> · {difference.kinds.map((kind) => differenceLabels[kind]).join(", ")}</li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if target.problem}<span>{target.problem}</span>{/if}
      {#if target.needsRecovery}<button type="button" disabled={busy || editing} onclick={() => recover(target.destination.path)}>Recover install</button>{/if}
      <div class="buttons">
        {#each target.actions as action}
          <button disabled={editing || busy} onclick={() => prepare(action, target.destination.path)}>Review {action}</button>
        {/each}
      </div>
    </div>
  {:else}
    <p>Add a destination in Skills settings to install this skill.</p>
    <button type="button" class="text-button" disabled={busy || editing} onclick={openSettings}>Add destination →</button>
  {/each}
</section>
