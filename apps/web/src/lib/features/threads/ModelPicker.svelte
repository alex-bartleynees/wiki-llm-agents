<script lang="ts">
  import type { ProviderModel } from "@wiki-agents/contracts/providers/model";
  import { errorMessage, isAbort } from "#lib/api/client.ts";
  import { listModels, setModel } from "./api.ts";
  import { openThread } from "./open-thread.svelte.ts";

  let { threadId }: { threadId: string } = $props();

  let models = $state<ReadonlyArray<ProviderModel>>([]);
  let current = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);

  $effect(() => {
    const controller = new AbortController();
    models = [];
    error = undefined;
    listModels(threadId, controller.signal).then(
      (response) => {
        models = response.models;
        current = response.current;
      },
      (failure) => {
        if (!isAbort(failure)) error = errorMessage(failure, "Couldn't list models");
      },
    );
    return () => controller.abort();
  });

  const choose = async (model: string) => {
    const previous = current;
    current = model;
    busy = true;
    try {
      const { thread } = await setModel(threadId, model);
      openThread.updated(thread);
      error = undefined;
    } catch (failure) {
      current = previous;
      error = errorMessage(failure, "Couldn't switch the model");
    } finally {
      busy = false;
    }
  };

  /** Free models first, each group by name. */
  const sorted = $derived([...models].sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name)));
</script>

{#if error}
  <span class="error mono" title={error}>Models unavailable</span>
{:else if models.length > 0}
  <select
    class="mono"
    aria-label="Model"
    title="Model, from the next message"
    disabled={busy}
    value={current ?? ""}
    onchange={(event) => void choose(event.currentTarget.value)}
  >
    {#if current === null}<option value="" disabled>Default model</option>{/if}
    {#each sorted as model (model.id)}
      <option value={model.id}>{model.name}{model.free ? " · free" : ""}</option>
    {/each}
  </select>
{/if}

<style>
  select {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 50%;
    height: 28px;
    padding: 0 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink-2);
    font-size: 11px;
  }
  .error {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--ink-3);
  }
</style>
