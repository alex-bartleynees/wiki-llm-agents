<script lang="ts">
  import type { InstallAction, InstallTarget } from "@wiki-agents/contracts/skills/model";
  import { installLabels } from "./install-labels.ts";
  import InstallStatus from "./InstallStatus.svelte";
  import Card from "#lib/ui/primitives/Card.svelte";
  import Button from "#lib/ui/primitives/Button.svelte";

  let { targets, busy, editing, recover, prepare, openSettings }: {
    targets: ReadonlyArray<InstallTarget>;
    busy: boolean;
    editing: boolean;
    recover: (destination: string) => void;
    prepare: (action: InstallAction, destination: string) => void;
    openSettings: () => void;
  } = $props();
  let section = $state<HTMLElement>();

  const differenceLabels = {
    content: "Content differs",
    permissions: "Permissions differ",
    "entry type": "File or directory type differs",
    "only installed": "Only in the installed copy",
    "only library": "Only in the library",
  } as const;

  export function reveal() {
    section?.scrollIntoView({ block: "start" });
    section?.focus({ preventScroll: true });
  }
</script>

<div class="installs">
  <Card size="medium" class={["installations", !targets.length && "empty-installs"]} aria-label="Install destinations" tabindex={-1} bind:node={section}>
    <h3>Install destinations</h3>
    {#each targets as target (target.path)}
      <div class="target">
        <strong>{target.destination.labels.join(" · ")}</strong>
        <code class="mono">{target.path}</code>
        <InstallStatus status={target.status} text={installLabels[target.status]} />
        {#if target.status === "external installed" || target.status === "external differs"}<p>Managed outside wiki-agents</p>{/if}
        {#if target.differences?.length}
          <div class="install-differences" role="group" aria-label="Differences from library">
            <strong>Differences from library</strong>
            <ul>
              {#each target.differences as difference (difference.path)}
                <li><code class="mono">{difference.path}</code> · {difference.kinds.map((kind) => differenceLabels[kind]).join(", ")}</li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if target.problem}<span>{target.problem}</span>{/if}
        {#if target.needsRecovery}<Button size="large" disabled={busy || editing} onclick={() => recover(target.destination.path)}>Recover install</Button>{/if}
        <div class="buttons">
          {#each target.actions as action}
            <Button size="large" disabled={editing || busy} onclick={() => prepare(action, target.destination.path)}>Review {action}</Button>
          {/each}
        </div>
      </div>
    {:else}
      <p>Add a destination in Skills settings to install this skill.</p>
      <Button variant="link" size="large" disabled={busy || editing} onclick={openSettings}>Add destination →</Button>
    {/each}
  </Card>
</div>

<style>
  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  p {
    margin: 0;
  }

  ul {
    margin: 0;
    padding-left: 18px;
  }

  code {
    overflow-wrap: anywhere;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .installs {
    min-width: 0;
  }

  .installs > :global(.installations) {
    scroll-margin: 12px;
  }

  .installs > :global(.installations:focus) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .installs > :global(.empty-installs) {
    border-style: dashed;
  }

  .target {
    display: grid;
    gap: 6px;
    padding-block: 8px;
    overflow-wrap: anywhere;

    + .target {
      border-top: 1px solid var(--line);
    }

    .buttons:empty {
      display: none;
    }
  }

  .install-differences {
    color: var(--ink-2);
    font-size: 13px;
  }
</style>
