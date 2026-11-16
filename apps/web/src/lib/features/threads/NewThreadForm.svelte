<script lang="ts">
  import type { ProviderModel } from "@wiki-agents/contracts/providers/model";
  import { untrack } from "svelte";
  import { errorMessage, isAbort } from "#lib/api/client.ts";
  import { agents } from "#lib/features/agents/agents.svelte.ts";
  import { listProviderModels } from "#lib/features/agents/api.ts";
  import { suggestedBranch, worktrees } from "#lib/features/projects/worktrees.svelte.ts";
  import { providers } from "./providers.svelte.ts";
  import { threads } from "./threads.svelte.ts";
  let { vaultId, projectId, label = "New thread", compact = false, onstarted }: {
    vaultId: string; projectId: string | null; label?: string; compact?: boolean; onstarted?: () => Promise<void>;
  } = $props();
  const chosen = $derived(providers.chosen);
  const status = $derived(chosen === undefined ? undefined : providers.statuses[chosen.id]);
  const canWorktree = $derived(worktrees.available(projectId));
  let useWorktree = $state(false);
  let branch = $state(suggestedBranch());
  let starting = $state(false);
  let error = $state<string | undefined>();
  let models = $state<ReadonlyArray<ProviderModel>>([]);
  let modelError = $state<string | undefined>();
  let loadingModels = $state(false);
  $effect(() => { void agents.load(); void providers.load().then(() => {
    if (providers.chosen) void providers.check(providers.chosen.id);
  }); });
  $effect(() => {
    const id = projectId;
    untrack(() => { useWorktree = false; branch = suggestedBranch(); error = undefined; });
    if (id !== null) void worktrees.load(id);
  });
  $effect(() => {
    const provider = chosen;
    models = []; modelError = undefined; loadingModels = false;
    if (!provider?.capabilities.models) return;
    const controller = new AbortController();
    loadingModels = true;
    void listProviderModels(provider.id, controller.signal).then(result => {
      if (!controller.signal.aborted) models = result.models;
    }).catch(cause => {
      if (!isAbort(cause) && !controller.signal.aborted) modelError = errorMessage(cause, "Couldn't list models");
    }).finally(() => { if (!controller.signal.aborted) loadingModels = false; });
    return () => controller.abort();
  });
  const chooseAgent = (id: string) => {
    agents.choose(id === "" ? null : id);
    const provider = agents.chosen?.provider;
    if (provider != null && providers.get(provider) !== undefined) providers.choose(provider);
    providers.chooseModel("");
  };
  async function start() {
    if (starting) return;
    starting = true; error = undefined;
    try {
      await threads.startIn({ vaultId, projectId }, canWorktree && useWorktree ? { worktreeBranch: branch.trim() } : {});
      useWorktree = false; branch = suggestedBranch();
      await onstarted?.();
    } catch (cause) { error = errorMessage(cause, "Could not start a thread"); }
    finally { starting = false; }
  }
</script>
<form class:compact aria-label="New thread" onsubmit={(event) => { event.preventDefault(); void start(); }}>
  <fieldset disabled={starting}>
  <div class="start">
    {#if providers.list.length > 1}
      <select
        aria-label="Provider for new threads"
        value={chosen?.id}
        onchange={(event) => providers.choose(event.currentTarget.value)}
      >
        {#each providers.list as provider (provider.id)}
          <option value={provider.id}>{provider.name}</option>
        {/each}
      </select>
    {/if}
    <select aria-label="Agent for new threads" value={agents.chosen?.id ?? ""} onchange={(event) => chooseAgent(event.currentTarget.value)}>
      <option value="">No agent</option>
      {#each agents.list as agent (agent.id)}
        <option value={agent.id}>{agent.name}</option>
      {/each}
    </select>
    {#if chosen?.capabilities.models}
      <select aria-label="Model for new threads" value={providers.model} disabled={loadingModels} onchange={(event) => providers.chooseModel(event.currentTarget.value)}>
        <option value="">{loadingModels ? "Loading models…" : "Default model (agent or provider)"}</option>
        {#if providers.model && !models.some(model => model.id === providers.model)}
          <option value={providers.model}>{providers.model}</option>
        {/if}
        {#each models as model (model.id)}<option value={model.id}>{model.name}{model.free ? " · free" : ""}</option>{/each}
      </select>
    {/if}
    <button type="submit" class="new" disabled={starting || (canWorktree && useWorktree && !branch.trim())}>{label}</button>
  </div>
  {#if canWorktree}
    <div class="worktree">
      <label class="toggle">
        <input type="checkbox" bind:checked={useWorktree} />
        Worktree
      </label>
      {#if useWorktree}
        <input
          class="branch mono"
          aria-label="Branch for the new thread's worktree"
          bind:value={branch}
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
        />
      {:else}
        <span class="hint">own branch and checkout</span>
      {/if}
    </div>
  {/if}

  </fieldset>
  {#if status !== undefined && status !== "checking" && status._tag === "unavailable"}<p class="warning" role="status">{chosen?.name} can't run turns: {status.reason}</p>{/if}
  {#if modelError}<p class="warning" role="status">{modelError}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>
<style>
  form { width: 100%; min-width: 0; }
  form.compact { width: fit-content; max-width: 100%; align-self: flex-start; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .start { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
  select { flex: 1 1 140px; min-width: 0; max-width: 100%; }
  .compact select { flex: 0 1 auto; max-width: min(240px, 100%); }
  select, .branch { height: 36px; padding: 0 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); color: var(--ink-2); font: inherit; font-size: 12px; }
  .new { height: 36px; padding: 0 12px; border: 0; border-radius: var(--radius); background: var(--accent); color: var(--on-accent); font: inherit; cursor: pointer; }
  .new:disabled { opacity: 0.6; cursor: default; }
  .worktree { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; }
  .toggle { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
  .branch { flex: 1; min-width: 0; }
  .compact .branch { flex: 0 1 260px; width: 260px; }
  .hint, .warning { color: var(--ink-3); font-size: 12px; }
  .error { color: var(--del); }
  p { margin: 8px 0 0; }
  @media (max-width: 899px) {
    select, .branch, .new { min-height: 44px; font-size: 16px; }
    .toggle { min-height: 44px; }
    form.compact { width: 100%; }
    .compact fieldset { gap: 16px; }
    .compact .start { flex-direction: column; gap: 10px; }
    .compact select, .compact .new { flex: none; width: 100%; max-width: 100%; box-sizing: border-box; }
    .compact .worktree { flex-wrap: wrap; }
    .compact .branch { flex-basis: 100%; width: 100%; box-sizing: border-box; }
  }
</style>
