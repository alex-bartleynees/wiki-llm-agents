<script lang="ts">
  import type { Vault } from "@wiki-agents/contracts/vaults/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import FolderPicker from "#lib/ui/primitives/FolderPicker.svelte";
  import { vaults } from "./vaults.svelte.ts";
  import Button from "#lib/ui/primitives/Button.svelte";
  import Input from "#lib/ui/primitives/Input.svelte";

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
      <Input
        id="vault-folder"
        mono
        bind:value={rootPath}
        required
        placeholder="~/Documents/obsidian-vault"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <Button class="browse" onclick={() => (picking = true)}>Browse…</Button>
    </div>
  </div>
  <label>
    <span>Name <em>(optional)</em></span>
    <Input bind:value={name} placeholder="Defaults to the folder name" autocomplete="off" />
  </label>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <Button variant="primary" class="submit" type="submit" disabled={saving || rootPath.trim() === ""}>{saving ? "Adding…" : "Add vault"}</Button>
  <p class="hint">Agents and the editor write to the vault; every agent change can be reviewed and undone.</p>
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
  .path > :global(.browse) {
    flex: none;
  }
  form > :global(.submit) {
    justify-self: start;
  }
  em {
    font-style: normal;
    color: var(--ink-3);
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
