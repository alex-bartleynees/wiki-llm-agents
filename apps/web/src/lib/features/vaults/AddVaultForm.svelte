<script lang="ts">
  import type { Vault } from "@wiki-agents/contracts/vaults/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import FolderPicker from "#lib/ui/primitives/FolderPicker.svelte";
  import { vaults } from "./vaults.svelte.ts";

  let { onadded }: { onadded: (vault: Vault) => void } = $props();

  let rootPath = $state("");
  let name = $state("");
  let saving = $state(false);
  let picking = $state(false);
  let error = $state<string | undefined>(undefined);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    saving = true;
    error = undefined;
    try {
      onadded(await vaults.register(rootPath, name));
      rootPath = "";
      name = "";
    } catch (cause) {
      error = errorMessage(cause, "Could not add the vault");
    } finally {
      saving = false;
    }
  };
</script>

<form onsubmit={submit}>
  <div class="field">
    <label for="vault-folder">Folder</label>
    <div class="path">
      <input
        id="vault-folder"
        class="mono"
        bind:value={rootPath}
        required
        placeholder="~/Documents/obsidian-vault"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <button type="button" class="browse" onclick={() => (picking = true)}>Browse…</button>
    </div>
  </div>
  <label>
    <span>Name <em>(optional)</em></span>
    <input bind:value={name} placeholder="Defaults to the folder name" autocomplete="off" />
  </label>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <button type="submit" disabled={saving || rootPath.trim() === ""}>{saving ? "Adding…" : "Add vault"}</button>
  <p class="hint">The app only reads the vault for now; it never writes to it.</p>
</form>

<FolderPicker
  bind:open={picking}
  title="Choose the vault folder"
  start={rootPath.trim() === "" ? null : rootPath.trim()}
  load={machineFolders}
  onchoose={(path) => (rootPath = path)}
  typed
/>

<style>
  form {
    display: grid;
    gap: 12px;
    max-width: 520px;
  }
  label,
  .field {
    display: grid;
    gap: 4px;
  }
  .field > label,
  label span {
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-2);
  }
  .path {
    display: flex;
    gap: 6px;
  }
  .path input {
    flex: 1;
    min-width: 0;
  }
  .browse {
    flex: 0 0 auto;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  em {
    font-style: normal;
    color: var(--ink-3);
  }
  input {
    height: 38px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 14px;
    color: var(--ink);
  }
  input:not(.mono) {
    font-family: inherit;
  }
  button {
    justify-self: start;
    height: 38px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    font: inherit;
    font-weight: 600;
    color: var(--on-accent);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .error {
    margin: 0;
    color: var(--del);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--ink-3);
  }
</style>
