<script lang="ts">
  import type { Project } from "@wiki-agents/contracts/projects/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { projects } from "./projects.svelte.ts";

  /** Says the project is archived, with a way back. */
  let { project }: { project: Project } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function restore() {
    busy = true;
    error = null;
    try {
      await projects.restore(project.id);
    } catch (cause) {
      error = errorMessage(cause, "Could not restore the project");
    } finally {
      busy = false;
    }
  }
</script>

<div class="notice" role="status">
  <p>Archived. Its threads and changed files are kept; restore it to start new threads.</p>
  <button type="button" disabled={busy} onclick={restore}>Restore project</button>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 10px 12px;
    background: var(--sunken);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--ink-2);
  }
  p {
    margin: 0;
    flex: 1 1 220px;
  }
  button {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .error {
    flex-basis: 100%;
    color: var(--del);
  }
</style>
