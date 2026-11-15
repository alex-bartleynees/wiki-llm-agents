<script lang="ts">
  import type { GetCommitMessageSettingsResponse } from "@wiki-agents/contracts/projects/get-commit-message-settings/response";
  import type { ProviderInstance } from "@wiki-agents/contracts/providers/model";
  import { untrack } from "svelte";
  import { errorMessage } from "#lib/api/client.ts";
  import { listProviderModels } from "#lib/features/agents/api.ts";
  import { listProviders } from "#lib/features/threads/api.ts";
  import { getCommitMessageSettings, saveCommitMessageSettings } from "./api.ts";

  /**
   * Which provider and model write **Suggest message** in the Diff view. The default is
   * Claude Code on Haiku when it is ready, else the first provider. One call per
   * suggestion: no tools, the ticked files' diffs and recent subjects only.
   */
  const DEFAULT = "";

  let view = $state<GetCommitMessageSettingsResponse | null>(null);
  let providers = $state<ReadonlyArray<ProviderInstance>>([]);
  let providerId = $state(DEFAULT);
  let model = $state("");
  let models = $state<ReadonlyArray<string>>([]);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);

  const changed = $derived(
    view !== null && (providerId !== (view.settings.providerInstanceId ?? DEFAULT) || (providerId === DEFAULT ? false : model.trim() !== (view.settings.model ?? ""))),
  );
  const effectiveLabel = $derived(
    view === null ? "" : view.effective === null ? "No provider is available." : `${view.effective.providerName}${view.effective.model === null ? " (its default model)" : ` · ${view.effective.model}`}`,
  );

  function show(next: GetCommitMessageSettingsResponse) {
    view = next;
    providerId = next.settings.providerInstanceId ?? DEFAULT;
    model = next.settings.model ?? "";
  }

  $effect(() => {
    untrack(() => {
      void Promise.all([getCommitMessageSettings(), listProviders()])
        .then(([settings, list]) => {
          providers = list.providers;
          show(settings);
        })
        .catch((cause: unknown) => (error = errorMessage(cause, "Could not load the commit message settings")));
    });
  });

  // Model suggestions for the chosen provider, when it offers a choice.
  $effect(() => {
    const id = providerId;
    models = [];
    const provider = providers.find((candidate) => candidate.id === id);
    if (provider === undefined || !provider.capabilities.models) return;
    const controller = new AbortController();
    void listProviderModels(id, controller.signal)
      .then((result) => {
        if (providerId === id) models = result.models.map((entry) => entry.id);
      })
      .catch(() => {});
    return () => controller.abort();
  });

  async function save() {
    saving = true;
    saved = false;
    error = null;
    try {
      show(await saveCommitMessageSettings({ providerInstanceId: providerId === DEFAULT ? null : providerId, model: providerId === DEFAULT ? null : model.trim() || null }));
      saved = true;
    } catch (cause) {
      error = errorMessage(cause, "Could not save");
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="settings"
  aria-label="Commit message suggestions"
  onsubmit={(event) => {
    event.preventDefault();
    void save();
  }}
>
  <label>
    <span class="label">Provider</span>
    <select bind:value={providerId} onchange={() => (saved = false)} aria-label="Provider for commit messages">
      <option value={DEFAULT}>Default: Claude Code on Haiku when ready, else the first provider</option>
      {#each providers as provider (provider.id)}
        <option value={provider.id}>{provider.name}</option>
      {/each}
    </select>
  </label>
  {#if providerId !== DEFAULT}
    <label>
      <span class="label">Model</span>
      <input
        bind:value={model}
        oninput={() => (saved = false)}
        list="commit-message-models"
        placeholder="The provider's default"
        aria-label="Model for commit messages"
        autocapitalize="off"
        spellcheck="false"
      />
      <datalist id="commit-message-models">
        {#each models as id (id)}<option value={id}></option>{/each}
      </datalist>
    </label>
  {/if}
  {#if view !== null}<p class="hint" aria-live="polite">Suggestions now use {effectiveLabel}</p>{/if}
  <div class="actions">
    <button type="submit" class="primary" disabled={!changed || saving} aria-label="Save commit message settings">{saving ? "Saving…" : "Save"}</button>
    {#if saved && !changed}<span class="hint" role="status">Saved.</span>{/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 12px;
    color: var(--ink-3);
  }
  select,
  input {
    height: 36px;
    box-sizing: border-box;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  .hint {
    margin: 0;
    color: var(--ink-3);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .primary {
    height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    margin: 0;
    color: var(--del);
  }
  /* Phone: 16px so focusing doesn't zoom. */
  @media (max-width: 899px) {
    select,
    input {
      height: 40px;
      font-size: 16px;
    }
  }
</style>
