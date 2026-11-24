<script lang="ts">
  import type { Settings, SettingsPreview } from "@wiki-agents/contracts/skills/model";
  import type { GetSettingsResponse } from "@wiki-agents/contracts/skills/get-settings/response";
  import { type Snippet, untrack } from "svelte";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import FolderPicker from "#lib/ui/primitives/FolderPicker.svelte";
  import Card from "#lib/ui/primitives/Card.svelte";
  import Input from "#lib/ui/primitives/Input.svelte";
  import Button from "#lib/ui/primitives/Button.svelte";

  let { view, busy, save, preview, resolved, onDraftChange, close, children }: {
    view: GetSettingsResponse;
    busy: boolean;
    save: (value: Settings, hash: string | null) => void;
    preview: (value: Settings) => void;
    resolved: SettingsPreview | null;
    onDraftChange: () => void;
    close: () => void;
    children: Snippet;
  } = $props();
  const initial = untrack(() => view.settings ?? { library: view.defaults.library, destinations: [] });
  let library = $state(initial.library);
  let picking = $state(false);
  let destinations = $state(initial.destinations.map((entry) => ({ ...entry })));

  function suggest(label: string, path: string) {
    if (!destinations.some((entry) => entry.path === path)) {
      destinations.push({ label, path });
      onDraftChange();
    }
  }
</script>

<div class="skills-settings">
  <form oninput={onDraftChange} onsubmit={(event) => { event.preventDefault(); save({ library, destinations }, view.hash); }}>
    <header>
      <Button variant="link" size="large" class="back" aria-label="Back to skills" disabled={busy} onclick={close}>← <span class="back-label">Back to skills</span></Button>
      <div class="settings-heading">
        <h1>Skills settings</h1>
        <div class="buttons save-actions">
          <Button size="large" class="close" disabled={busy} onclick={close}>Close settings</Button>
          <Button variant="primary" size="large" class="save" type="submit" disabled={busy}>Save Skills settings</Button>
        </div>
      </div>
      <p class="muted host-hint">Paths are on the wiki-agents host. Use a dedicated local folder, checkout or synced library.</p>
    </header>
    {@render children()}
    <fieldset disabled={busy} aria-label="Local Skills settings">
      <Card size="large" aria-labelledby="skills-library-heading">
        <h2 id="skills-library-heading">Library folder</h2>
        <p class="muted">Each skill is a folder containing a SKILL.md.</p>
        <div class="library-field">
          <div class="path-picker">
            <Input size="large" mono aria-label="Library folder" bind:value={library} required autocomplete="off" autocapitalize="off" spellcheck="false" />
            <Button size="large" class="browse" onclick={() => (picking = true)}>Browse…</Button>
          </div>
          <Button size="large" onclick={() => { library = view.defaults.library; onDraftChange(); }}>Use app-managed folder</Button>
        </div>
      </Card>
      <Card size="large" aria-labelledby="skills-destinations-heading">
        <div class="destinations">
          <div class="section-heading">
            <div>
              <h2 id="skills-destinations-heading">Install destinations</h2>
              <p class="muted">Folders your agents read skills from.</p>
            </div>
            <Button size="large" class="add-destination" aria-label="Add destination" onclick={() => { destinations.push({ label: "", path: "" }); onDraftChange(); }}>+ Custom destination</Button>
          </div>
          {#each destinations as destination, index}
            <div class="destination">
              <label>Destination label <Input size="large" bind:value={destination.label} required maxlength={100} /></label>
              <label>Destination folder <Input size="large" mono bind:value={destination.path} required /></label>
              <Button size="large" onclick={() => { destinations.splice(index, 1); onDraftChange(); }}>Remove destination</Button>
            </div>
          {:else}
            <div class="no-destinations">
              <strong>No destinations yet</strong>
              <p class="muted">Skills stay in the library until you add one.</p>
            </div>
          {/each}
          <div class="presets">
            {#each view.defaults.destinations as { label, path }}
              <div class="preset">
                <div><strong>{label}</strong><p class="muted">Preset path</p></div>
                <Button size="large" title={path} aria-label={"Add " + label + " path"} disabled={destinations.some((entry) => entry.path === path)} onclick={() => suggest(label, path)}>+ Add</Button>
              </div>
            {/each}
          </div>
        </div>
      </Card>
      <Card size="large" aria-label="Resolved paths">
        <div class="section-heading">
          <div>
            <h2>Resolved paths</h2>
            <p class="muted">Check where skills will be read from and written to before you save.</p>
          </div>
          <Button size="large" onclick={() => preview({ library, destinations })}>Preview resolved paths</Button>
        </div>
        <div class="paths-preview">
          {#if resolved}
            {#if resolved.diagnostics.length}
              <ul class="diagnostics">
                {#each resolved.diagnostics as diagnostic}
                  <li data-kind={diagnostic.kind}>{diagnostic.message}</li>
                {/each}
              </ul>
            {/if}
            <dl class="resolved-list">
              {#each [{ label: "Library", ...resolved.library }, ...resolved.destinations] as entry}
                <div>
                  <dt>{entry.label}</dt>
                  <dd>Entered <code class="mono">{entry.enteredPath}</code></dd>
                  <dd>Resolved <code class="mono">{entry.resolvedPath ?? "Unavailable"}</code></dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p class="mono muted">Run a preview to see resolved paths here.</p>
          {/if}
        </div>
      </Card>
    </fieldset>
  </form>
</div>

<FolderPicker
  bind:open={picking}
  title="Choose the library folder"
  start={library.trim() || null}
  load={machineFolders}
  onchoose={(path) => { library = path; onDraftChange(); }}
  typed
/>

<style>
  .skills-settings { max-width: 880px; margin: 0 auto; padding: 28px 24px 40px; }
  h2, p, dl { margin: 0; }
  ul { margin: 0; padding-left: 18px; }
  label { display: grid; gap: 5px; }
  code { overflow-wrap: anywhere; }
  .muted { color: var(--ink-3); }
  .buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  h1 { margin: 0; font: 600 30px/1.2 var(--font-read); }
  header { margin-bottom: 22px; }
  .host-hint { max-width: 550px; margin-top: 10px; }
  .settings-heading, .section-heading { display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 10px; }
  header > :global(.back) { margin-bottom: 5px; gap: 4px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 24px; }
  h2 { margin-bottom: 4px; font-size: 18px; font-weight: 600; line-height: 1.2; }
  .library-field, .path-picker { display: flex; gap: 8px; align-items: center; min-width: 0; }
  .library-field { margin-top: 16px; }
  .path-picker { flex: 1; }
  .path-picker > :global(.browse) { flex: none; }
  .destinations { display: grid; gap: 14px; }
  .no-destinations, .preset, .destination, .paths-preview { padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-md); }
  .no-destinations { border-style: dashed; }
  .presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .preset { display: flex; gap: 8px; justify-content: space-between; align-items: center; background: var(--bg); }
  .preset p { font-size: 13px; }
  .destination { display: grid; grid-template-columns: 1fr 1.5fr auto; align-items: end; gap: 8px; }
  .paths-preview { margin-top: 16px; color: var(--ink-2); background: var(--sunken); font-size: 13px; }
  .resolved-list { display: grid; gap: 12px; }
  .resolved-list dt { font-weight: 600; }
  .resolved-list dd { margin: 0; overflow-wrap: anywhere; }
  .diagnostics { margin: 0 0 10px; padding-left: 18px; }
  .diagnostics [data-kind="alias"] { color: var(--accent-ink); }
  .diagnostics [data-kind="overlap"], .diagnostics [data-kind="invalid"] { color: var(--del); }
  @media (max-width: 699px) {
    .skills-settings { padding: 16px 16px 96px; }
    header { display: flex; flex-wrap: wrap; align-items: center; margin-bottom: 16px; column-gap: 10px; }
    header > :global(.back) { margin: 0; font-size: 18px; }
    .back-label, .save-actions > :global(.close) { display: none; }
    .save-actions { position: fixed; inset: auto 0 0; z-index: 2; background: var(--surface); border-top: 1px solid var(--line); padding: 11px 16px max(11px, env(safe-area-inset-bottom)); }
    .save-actions > :global(.save) { width: 100%; }
    fieldset { gap: 16px; }
    .library-field { display: grid; }
    .presets, .destination { grid-template-columns: minmax(0, 1fr); }
    .destinations .section-heading { display: contents; }
    .destinations > .section-heading > :global(.add-destination) { order: 1; }
  }
</style>
