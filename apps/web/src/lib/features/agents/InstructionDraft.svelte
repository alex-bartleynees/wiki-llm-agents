<script lang="ts">
  import {
    DRAFT_DESCRIPTION_MAX,
    DRAFT_IDEA_MAX,
    DRAFT_INSTRUCTIONS_MAX,
    DRAFT_NAME_MAX,
  } from "@wiki-agents/contracts/agents/draft-instructions/request";
  import type { AgentInput } from "@wiki-agents/contracts/agents/model";
  import { onDestroy, untrack } from "svelte";
  import { errorMessage } from "#lib/api/client.ts";
  import { providers } from "#lib/features/threads/providers.svelte.ts";
  import { draftInstructions } from "./api.ts";
  import type { ModelDiscovery } from "./model-discovery.svelte.ts";

  let { discovery, input, canRevise, onapply, ondiscard }: {
    discovery: ModelDiscovery;
    input: AgentInput;
    canRevise: boolean;
    onapply: (instructions: string) => void;
    ondiscard: () => void;
  } = $props();

  let idea = $state("");
  let includeCurrent = $state(false);
  let providerChoice = $state<string | null>(null);
  let modelChoice = $state<string | null>(null);
  const availableProviders = $derived(providers.list.filter((entry) => entry.toolFreeCompletion));
  const configuredProvider = $derived(availableProviders.find((entry) => entry.id === input.provider));
  const provider = $derived(
    availableProviders.find((entry) => entry.id === providerChoice)
    ?? configuredProvider
    ?? availableProviders.find((entry) => entry.id === providers.chosen?.id)
    ?? availableProviders[0],
  );

  const discovered = $derived(discovery.get(provider?.id));
  const models = $derived(discovered?.status === "ready" ? discovered.result.models : []);
  const defaultModel = $derived(discovered?.status === "ready" ? discovered.result.defaultModel : null);
  const loadingModels = $derived(provider?.capabilities.models === true && (discovered === undefined || discovered.status === "loading"));
  const modelError = $derived(discovered?.status === "failed" && provider?.capabilities.models ? discovered.message : undefined);
  const model = $derived(modelChoice ?? (
    providerChoice === null && configuredProvider && models.some(({ id }) => id === input.model) ? input.model ?? "" : ""
  ));

  $effect(() => {
    const selected = provider;
    if (selected?.capabilities.models) untrack(() => discovery.load(selected.id));
  });

  let pending = $state(false);
  let preview = $state<string | undefined>();
  let error = $state<string | undefined>();
  let active = true;
  onDestroy(() => { active = false; });

  const inputError = $derived(
    input.name.length > DRAFT_NAME_MAX ? `Name must be at most ${DRAFT_NAME_MAX} characters to generate a draft.`
    : input.description.length > DRAFT_DESCRIPTION_MAX ? `Description must be at most ${DRAFT_DESCRIPTION_MAX} characters to generate a draft.`
    : includeCurrent && input.instructions.length > DRAFT_INSTRUCTIONS_MAX ? `Current instructions must be at most ${DRAFT_INSTRUCTIONS_MAX} characters to include them.`
    : undefined
  );

  const generate = async () => {
    if (!provider || pending || !idea.trim() || inputError || loadingModels) return;
    pending = true;
    error = undefined;
    try {
      const result = await draftInstructions({
        providerInstanceId: provider.id,
        model: model || null,
        idea: idea.trim(),
        ...(input.name.trim() ? { name: input.name } : {}),
        ...(input.description.trim() ? { description: input.description } : {}),
        ...(canRevise && includeCurrent && input.instructions.trim() ? { currentInstructions: input.instructions } : {}),
      });
      if (active) preview = result.instructions;
    } catch (failure) {
      if (active) error = errorMessage(failure, "Couldn't generate a draft.");
    } finally {
      if (active) pending = false;
    }
  };
</script>

<section aria-label="Draft instructions">
  <label>
    Idea
    <textarea bind:value={idea} rows="4" maxlength={DRAFT_IDEA_MAX} disabled={pending}></textarea>
  </label>
  <div class="choices">
    <label>
      Draft provider
      <select value={provider?.id ?? ""} disabled={pending || !provider} onchange={(event) => {
        providerChoice = event.currentTarget.value;
        modelChoice = null;
      }}>
        {#if !provider}<option value="">No drafting provider available</option>{/if}
        {#each availableProviders as entry (entry.id)}
          <option value={entry.id}>{entry.name}</option>
        {/each}
      </select>
    </label>
    <label>
      Draft model
      <select value={model} disabled={pending || loadingModels || models.length === 0} onchange={(event) => (modelChoice = event.currentTarget.value)}>
        <option value="">Provider default{defaultModel ? ` (${defaultModel})` : ""}</option>
        {#each models as entry (entry.id)}
          <option value={entry.id}>{entry.name}</option>
        {/each}
      </select>
    </label>
  </div>
  {#if loadingModels}<p role="status">Loading models…</p>{/if}
  {#if modelError}
    <p role="alert">{modelError}</p>
    <button type="button" disabled={pending} onclick={() => provider && discovery.load(provider.id, true)}>Reload models</button>
  {/if}
  {#if canRevise}
    <label class="include">
      <input type="checkbox" bind:checked={includeCurrent} disabled={pending} />
      Include current instructions
    </label>
  {/if}
  {#if inputError}<p role="alert">{inputError}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if pending}<p role="status">Generating draft…</p>{/if}
  {#if preview !== undefined}
    <pre aria-label="Draft preview">{preview}</pre>
    {#if input.instructions.trim()}<p>Using this draft replaces the text in Instructions.</p>{/if}
  {/if}
  <div class="actions">
    <button type="button" disabled={pending || loadingModels || !provider || !idea.trim() || !!inputError} onclick={() => void generate()}>
      {error ? "Retry" : preview === undefined ? "Generate draft" : "Regenerate"}
    </button>
    {#if preview !== undefined}
      <button type="button" disabled={pending} onclick={() => onapply(preview!)}>Use draft</button>
    {/if}
    <button type="button" onclick={ondiscard}>Discard draft</button>
  </div>
</section>

<style>
  section {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  label {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 13px;
  }
  label.include {
    display: flex;
    align-items: center;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
    gap: 8px;
  }
  textarea, select, button, pre {
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    min-width: 0;
  }
  textarea {
    resize: vertical;
  }
  pre {
    margin: 0;
    max-height: 18rem;
    overflow: auto;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    font-family: var(--font-mono);
  }
  p {
    margin: 0;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  p[role="alert"] {
    color: var(--del);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  button:disabled {
    opacity: 0.55;
  }
  @media (max-width: 899px) {
    textarea, select {
      font-size: 16px;
    }
  }
</style>
