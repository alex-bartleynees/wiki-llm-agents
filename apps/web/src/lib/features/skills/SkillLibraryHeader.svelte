<script lang="ts">
  import type { GetSettingsResponse } from "@wiki-agents/contracts/skills/get-settings/response";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import FolderPicker from "#lib/ui/primitives/FolderPicker.svelte";
  import PathChip from "./PathChip.svelte";
  import Input from "#lib/ui/primitives/Input.svelte";
  import Button from "#lib/ui/primitives/Button.svelte";

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
        <PathChip label={settings.settings.library} path={settings.settings.library} {busy} copy={copyPath} />
      </div>
      <div class="buttons">
        <Button size="large" class="import-action" disabled={busy || editing} aria-expanded={author === "import"} onclick={() => (author = author === "import" ? null : "import")}>Import</Button>
        <Button size="large" class="settings-action" aria-label="Skills settings" disabled={busy || editing} onclick={openSettings}>Settings</Button>
        <Button variant="primary" size="large" class="new-skill" disabled={busy || editing} aria-expanded={author === "create"} onclick={() => (author = author === "create" ? null : "create")}>+ New skill</Button>
      </div>
    </div>
    {#if author === "create"}
      <form class="author-form" onsubmit={submitCreate}>
        <label>New skill name <Input size="large" bind:value={name} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength={64} /></label>
        <Button variant="primary" size="large" type="submit" disabled={busy || editing}>Create skill</Button>
      </form>
    {:else if author === "import"}
      <form class="author-form" onsubmit={submitImport}>
        <div class="import-field">
          <label for="skill-import-folder">Local folder to import</label>
          <div class="import-path">
            <Input size="large" id="skill-import-folder" mono bind:value={importPath} required placeholder="/path/to/skill" autocomplete="off" autocapitalize="off" spellcheck="false" />
            <Button size="large" class="browse" disabled={busy} onclick={() => (pickingImport = true)}>Browse…</Button>
          </div>
        </div>
        <Button variant="primary" size="large" type="submit" disabled={busy || editing}>Import skill</Button>
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
    <Button variant="primary" size="large" onclick={openSettings}>Set up Skills</Button>
  {/if}
</header>

<style>
  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  label {
    display: grid;
    gap: 5px;
  }

  .library-header {
    display: grid;
    gap: 8px;
    margin-bottom: 24px;

    .catalog-heading {
      margin: 0;
    }
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .library-path {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--ink-3);
  }

  .library-path :global(.path-chip) {
    background: var(--surface);
  }

  .author-form {
    display: flex;
    align-items: end;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);

    label {
      flex: 1;
    }
  }

  .import-field {
    flex: 1;
    min-width: 0;
  }

  .import-path {
    display: flex;
    align-items: center;
    gap: 8px;

    > :global(.browse) {
      flex: none;
    }
  }

  @media (max-width: 699px) {
    .library-header {
      position: relative;
      min-height: 40px;
      margin-bottom: 12px;

      h1 {
        align-self: center;
      }
    }

    .toolbar {
      position: absolute;
      top: 0;
      right: 0;
    }

    .library-path {
      display: none;
    }

    .toolbar :global(.import-action) {
      order: 1;
    }

    .toolbar :global(.new-skill) {
      position: fixed;
      right: 16px;
      bottom: calc(16px + env(safe-area-inset-bottom));
      z-index: 2;
      min-height: 50px;
      padding-inline: 18px;
      border-radius: 999px;
    }

    .author-form {
      flex-direction: column;
      align-items: stretch;
      margin-top: 8px;
    }
  }
</style>
