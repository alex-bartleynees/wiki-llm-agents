<script lang="ts">
  import type { GetSettingsResponse } from "@wiki-agents/contracts/skills/get-settings/response";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import FolderPicker from "#lib/ui/primitives/FolderPicker.svelte";

  let { settings, busy, editing, author = $bindable(), create, importFolder, copyPath, openSettings }: {
    settings: GetSettingsResponse | null;
    busy: boolean;
    editing: boolean;
    author: "create" | "import" | null;
    create: (name: string) => Promise<boolean>;
    importFolder: (path: string) => Promise<boolean>;
    copyPath: (path: string) => void;
    openSettings: () => void;
  } = $props();
  let name = $state("");
  let importPath = $state("");
  let pickingImport = $state(false);

  async function submitCreate(event: SubmitEvent) {
    event.preventDefault();
    if (await create(name)) name = "";
  }

  async function submitImport(event: SubmitEvent) {
    event.preventDefault();
    if (await importFolder(importPath)) importPath = "";
  }
</script>

<header class="library-header">
  <h1 class="catalog-heading">Skills</h1>
  {#if settings?.settings}
    <div class="toolbar">
      <div class="library-path">
        <span>Library</span>
        <div class="path-chip">
          <code title={settings.settings.library}>{settings.settings.library}</code>
          <button class="text-button" type="button" disabled={busy} onclick={() => copyPath(settings?.settings?.library ?? "")}>Copy</button>
        </div>
      </div>
      <div class="buttons">
        <button type="button" class="import-action" disabled={busy || editing} aria-expanded={author === "import"} onclick={() => (author = author === "import" ? null : "import")}>Import</button>
        <button type="button" class="settings-action" aria-label="Skills settings" disabled={busy || editing} onclick={openSettings}>Settings</button>
        <button type="button" class="primary new-skill" disabled={busy || editing} aria-expanded={author === "create"} onclick={() => (author = author === "create" ? null : "create")}>+ New skill</button>
      </div>
    </div>
    {#if author === "create"}
      <form class="author-form" onsubmit={submitCreate}>
        <label>New skill name <input bind:value={name} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="64" /></label>
        <button class="primary" disabled={busy || editing}>Create skill</button>
      </form>
    {:else if author === "import"}
      <form class="author-form" onsubmit={submitImport}>
        <div class="import-field">
          <label for="skill-import-folder">Local folder to import</label>
          <div class="import-path">
            <input id="skill-import-folder" class="mono-input" bind:value={importPath} required placeholder="/path/to/skill" autocomplete="off" autocapitalize="off" spellcheck="false" />
            <button type="button" disabled={busy} onclick={() => (pickingImport = true)}>Browse…</button>
          </div>
        </div>
        <button class="primary" disabled={busy || editing}>Import skill</button>
      </form>
      <FolderPicker
        bind:open={pickingImport}
        title="Choose the skill folder to import"
        start={importPath.trim() || settings.settings.library}
        load={machineFolders}
        onchoose={(path) => (importPath = path)}
        typed
      />
    {/if}
  {:else if settings}
    <button class="primary" onclick={openSettings}>Set up Skills</button>
  {/if}
</header>
