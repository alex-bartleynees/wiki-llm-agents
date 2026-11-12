<script lang="ts">
  import type { Vault } from "@wiki-agents/contracts/vaults/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { vaults } from "./vaults.svelte.ts";

  let { vault }: { vault: Vault } = $props();

  let folder = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state(false);
  // Follows the stored value until it's edited.
  $effect.pre(() => {
    folder = vault.templateFolder ?? "";
  });
  const changed = $derived(folder.trim() !== (vault.templateFolder ?? ""));

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    saving = true;
    error = null;
    saved = false;
    try {
      await vaults.setTemplateFolder(vault.id, folder);
      saved = true;
    } catch (cause) {
      error = errorMessage(cause, "Couldn't save the template folder");
    } finally {
      saving = false;
    }
  };
  const id = $derived(`template-folder-${vault.id}`);
</script>

<form onsubmit={save}>
  <label for={id}>Template folder</label>
  <div class="row">
    <input
      {id}
      class="mono"
      bind:value={folder}
      oninput={() => (saved = false)}
      placeholder="None (e.g. Templates)"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <button type="submit" disabled={saving || !changed}>{saving ? "Saving…" : "Save"}</button>
  </div>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if saved}
    <p class="hint" role="status">{vault.templateFolder === null ? "Templates are off." : "Saved. New notes can start from its notes."}</p>
  {:else}
    <p class="hint">A folder in this vault; each note in it is a template for new notes. Empty turns templates off.</p>
  {/if}
</form>

<style>
  form {
    display: grid;
    gap: 4px;
    margin-top: 6px;
  }
  label {
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-2);
  }
  .row {
    display: flex;
    gap: 6px;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 14px;
    color: var(--ink);
  }
  button {
    flex: 0 0 auto;
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    font: inherit;
    font-size: 13px;
    color: var(--ink);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .hint,
  .error {
    margin: 0;
    font-size: 12px;
    color: var(--ink-3);
  }
  .error {
    color: var(--del);
  }
  @media (max-width: 899px) {
    input {
      font-size: 16px;
    }
    input,
    button {
      height: 40px;
    }
  }
</style>
