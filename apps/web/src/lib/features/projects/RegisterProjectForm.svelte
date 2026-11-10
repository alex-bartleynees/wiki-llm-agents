<script lang="ts">
  import type { TreeEntry } from "@wiki-agents/contracts/notes/model";
  import type { Project } from "@wiki-agents/contracts/projects/model";
  import type { Vault } from "@wiki-agents/contracts/vaults/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import { getTree } from "#lib/features/notes/api.ts";
  import { foldersInside, parentFolder } from "#lib/features/notes/vault-folders.ts";
  import FolderPicker, { type FolderListing } from "#lib/ui/primitives/FolderPicker.svelte";
  import { registerProject } from "./api.ts";

  /**
   * `vault`: the shared vault new projects use, when known; `vaultLabel` says which
   * it is otherwise (there is no vault picker yet).
   */
  let { vault, vaultLabel, onregistered }: { vault: Vault | null; vaultLabel: string | null; onregistered: (project: Project) => void } = $props();

  let name = $state("");
  let kind = $state<"existing" | "new">("existing");
  /** The existing main directory, or the folder to create it in. */
  let main = $state("");
  let newFolderName = $state("");
  let more = $state<ReadonlyArray<string>>([]);
  let notesFolder = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  /** What the machine folder picker is choosing. */
  let picking = $state<"main" | "more" | null>(null);
  let machineOpen = $state(false);
  let notesOpen = $state(false);

  const pickMachine = (target: "main" | "more") => {
    picking = target;
    machineOpen = true;
  };
  const chosenOnMachine = (path: string) => {
    if (picking === "main") main = path;
    else if (picking === "more" && !more.includes(path)) more = [...more, path];
  };

  /** The vault's files, read once per picker session. */
  let tree: Promise<ReadonlyArray<TreeEntry>> | null = null;
  const vaultFolders = async (path: string | null): Promise<FolderListing> => {
    if (vault === null) throw new Error("No shared vault yet");
    tree ??= getTree(vault.id).then((response) => response.entries);
    const folder = path ?? "";
    const entries = await tree;
    return { path: folder, label: folder === "" ? vault.name : `${vault.name}/${folder}`, parent: parentFolder(folder), folders: foldersInside(entries, folder) };
  };
  const openNotes = () => {
    tree = null;
    notesOpen = true;
  };

  const mainDirectory = $derived(
    kind === "existing" ? main.trim() : main.trim() === "" || newFolderName.trim() === "" ? "" : `${main.trim().replace(/\/+$/, "")}/${newFolderName.trim()}`,
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      const { project } = await registerProject({
        name,
        workingDirectories: [mainDirectory, ...more].filter((path) => path !== ""),
        createDirectories: kind === "new",
        ...(notesFolder.trim() === "" ? {} : { notesFolder: notesFolder.trim() }),
      });
      name = "";
      main = "";
      newFolderName = "";
      more = [];
      notesFolder = "";
      kind = "existing";
      onregistered(project);
    } catch (cause) {
      error = errorMessage(cause, "Could not register the project");
    } finally {
      busy = false;
    }
  }
</script>

<form onsubmit={submit}>
  <h2>Register a project</h2>
  <label>
    Name
    <input id="project-name" bind:value={name} required placeholder="e.g. homelab-rebuild" />
  </label>

  <fieldset>
    <legend>Main directory</legend>
    <label class="choice"><input type="radio" name="kind" value="existing" bind:group={kind} />Existing repo or folder</label>
    <label class="choice"><input type="radio" name="kind" value="new" bind:group={kind} />Create a new empty folder</label>
    <div class="path">
      <input
        class="mono"
        aria-label={kind === "existing" ? "Directory path" : "Create inside"}
        bind:value={main}
        required
        placeholder={kind === "existing" ? "~/workspaces/…" : "Create inside ~/workspaces/…"}
        autocomplete="off"
        spellcheck="false"
      />
      <button type="button" class="browse" onclick={() => pickMachine("main")}>Browse…</button>
    </div>
    {#if kind === "new"}
      <input class="mono" aria-label="New folder name" bind:value={newFolderName} required placeholder="New folder name" autocomplete="off" spellcheck="false" />
      {#if mainDirectory !== ""}<span class="hint mono">Creates {mainDirectory}</span>{/if}
    {/if}
  </fieldset>

  <div class="field">
    <span>More directories (optional)</span>
    {#each more as path (path)}
      <div class="chosen">
        <span class="mono">{path}</span>
        <button type="button" aria-label="Remove {path}" onclick={() => (more = more.filter((other) => other !== path))}>×</button>
      </div>
    {/each}
    <button type="button" class="browse wide" onclick={() => pickMachine("more")}>Add directory…</button>
  </div>

  <div class="field">
    <span>Vault</span>
    <span class="vault">{vault?.name ?? vaultLabel ?? "Register a vault first"}</span>
  </div>

  <div class="field">
    <span>Notes folder (optional)</span>
    <div class="path">
      <input class="mono" aria-label="Notes folder" bind:value={notesFolder} placeholder="1-Active/homelab-rebuild" autocomplete="off" spellcheck="false" />
      <button type="button" class="browse" disabled={vault === null} onclick={openNotes}>Browse…</button>
    </div>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button class="submit" disabled={busy || (vault === null && vaultLabel === null)}>{busy ? "Registering…" : "Register"}</button>
</form>

<FolderPicker
  bind:open={machineOpen}
  title={picking === "more" ? "Add a working directory" : kind === "new" ? "Create the folder inside" : "Choose the main directory"}
  start={picking === "main" && main.trim() !== "" ? main.trim() : null}
  load={machineFolders}
  onchoose={chosenOnMachine}
  typed
/>
<FolderPicker
  bind:open={notesOpen}
  title="Choose the notes folder"
  start={notesFolder.trim() === "" ? null : notesFolder.trim()}
  load={vaultFolders}
  onchoose={(path) => (notesFolder = path)}
/>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: 13px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  label,
  .field,
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--ink-2);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 6px;
  }
  .choice {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    color: var(--ink);
  }
  .choice input {
    margin: 0;
    accent-color: var(--accent);
  }
  input:not([type="radio"]) {
    min-width: 0;
    height: 36px;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    padding: 0 10px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .path {
    display: flex;
    gap: 6px;
  }
  .path input {
    flex: 1;
  }
  .browse {
    flex: 0 0 auto;
    height: 36px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .browse:disabled {
    color: var(--ink-3);
    cursor: default;
  }
  .browse.wide {
    align-self: flex-start;
  }
  .hint {
    color: var(--ink-3);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .chosen {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line-soft);
    color: var(--ink);
  }
  .chosen .mono {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .chosen button {
    width: 28px;
    height: 28px;
    border: 0;
    background: transparent;
    color: var(--ink-3);
    font-size: 16px;
    cursor: pointer;
  }
  .vault {
    min-height: 36px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
    background: var(--sunken);
    color: var(--ink);
    font-size: 14px;
  }
  .submit {
    height: 40px;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .submit:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    margin: 0;
    color: var(--del);
  }
</style>
