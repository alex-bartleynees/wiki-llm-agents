<script lang="ts">
  import type { Settings, SettingsPreview } from "@wiki-agents/contracts/skills/model";
  import type { GetSettingsResponse } from "@wiki-agents/contracts/skills/get-settings/response";
  import { type Snippet, untrack } from "svelte";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import FolderPicker from "#lib/ui/primitives/FolderPicker.svelte";

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

<div class="skills-page skills-settings">
  <form oninput={onDraftChange} onsubmit={(event) => { event.preventDefault(); save({ library, destinations }, view.hash); }}>
    <header>
      <button class="text-button back" aria-label="Back to skills" type="button" disabled={busy} onclick={close}>← <span>Back to skills</span></button>
      <div class="settings-heading">
        <h1>Skills settings</h1>
        <div class="buttons save-actions">
          <button class="close" type="button" disabled={busy} onclick={close}>Close settings</button>
          <button class="primary" type="submit" disabled={busy}>Save Skills settings</button>
        </div>
      </div>
      <p class="muted host-hint">Paths are on the wiki-agents host. Use a dedicated local folder, checkout or synced library.</p>
    </header>
    {@render children()}
    <fieldset disabled={busy} aria-label="Local Skills settings">
      <section class="card" aria-labelledby="skills-library-heading">
        <h2 id="skills-library-heading">Library folder</h2>
        <p class="muted">Each skill is a folder containing a SKILL.md.</p>
        <div class="library-field">
          <div class="path-picker">
            <input class="mono-input" aria-label="Library folder" bind:value={library} required autocomplete="off" autocapitalize="off" spellcheck="false" />
            <button type="button" onclick={() => (picking = true)}>Browse…</button>
          </div>
          <button type="button" onclick={() => { library = view.defaults.library; onDraftChange(); }}>Use app-managed folder</button>
        </div>
      </section>
      <section class="card destinations" aria-labelledby="skills-destinations-heading">
        <div class="section-heading">
          <div>
            <h2 id="skills-destinations-heading">Install destinations</h2>
            <p class="muted">Folders your agents read skills from.</p>
          </div>
          <button class="add-destination" type="button" aria-label="Add destination" onclick={() => { destinations.push({ label: "", path: "" }); onDraftChange(); }}>+ Custom destination</button>
        </div>
        {#each destinations as destination, index}
          <div class="destination">
            <label>Destination label <input bind:value={destination.label} required maxlength="100" /></label>
            <label>Destination folder <input class="mono-input" bind:value={destination.path} required /></label>
            <button type="button" onclick={() => { destinations.splice(index, 1); onDraftChange(); }}>Remove destination</button>
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
              <button type="button" title={path} aria-label={"Add " + label + " path"} disabled={destinations.some((entry) => entry.path === path)} onclick={() => suggest(label, path)}>+ Add</button>
            </div>
          {/each}
        </div>
      </section>
      <section class="card" aria-label="Resolved paths">
        <div class="section-heading">
          <div>
            <h2>Resolved paths</h2>
            <p class="muted">Check where skills will be read from and written to before you save.</p>
          </div>
          <button type="button" onclick={() => preview({ library, destinations })}>Preview resolved paths</button>
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
                  <dd>Entered <code>{entry.enteredPath}</code></dd>
                  <dd>Resolved <code>{entry.resolvedPath ?? "Unavailable"}</code></dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p class="muted">Run a preview to see resolved paths here.</p>
          {/if}
        </div>
      </section>
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
  .skills-settings { max-width: 880px; }
  header { margin-bottom: 22px; }
  .host-hint { max-width: 550px; margin-top: 10px; }
  .settings-heading, .section-heading { display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 10px; }
  .back { margin-bottom: 5px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 24px; }
  .skills-settings .card { background: var(--surface); padding: 24px; }
  .card h2 { font-size: 18px; letter-spacing: 0; margin-bottom: 4px; }
  .library-field, .path-picker { display: flex; gap: 8px; align-items: center; min-width: 0; }
  .library-field { margin-top: 16px; }
  .path-picker { flex: 1; }
  .path-picker input { flex: 1; }
  .destinations { display: grid; gap: 14px; }
  .no-destinations, .preset, .destination, .paths-preview { padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--skill-control-radius); }
  .no-destinations { border-style: dashed; }
  .presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .preset { display: flex; gap: 8px; justify-content: space-between; align-items: center; background: var(--bg); }
  .preset p { font-size: 13px; }
  .destination { display: grid; grid-template-columns: 1fr 1.5fr auto; align-items: end; gap: 8px; }
  .paths-preview { margin-top: 16px; color: var(--ink-2); background: var(--sunken); font-family: var(--font-mono); font-size: 13px; }
  .resolved-list { display: grid; gap: 12px; font-family: var(--font-ui); }
  .resolved-list dt { font-weight: 600; }
  .resolved-list dd { margin: 0; overflow-wrap: anywhere; }
  .diagnostics { margin: 0 0 10px; padding-left: 18px; font-family: var(--font-ui); }
  .diagnostics [data-kind="alias"] { color: var(--accent-ink); }
  .diagnostics [data-kind="overlap"], .diagnostics [data-kind="invalid"] { color: var(--del); }
  @media (max-width: 699px) {
    .skills-settings { padding-bottom: 96px; }
    header { display: flex; flex-wrap: wrap; align-items: center; margin-bottom: 16px; column-gap: 10px; }
    .back { margin: 0; font-size: 18px; }
    .back span, .close { display: none; }
    .save-actions { position: fixed; inset: auto 0 0; z-index: 2; background: var(--surface); border-top: 1px solid var(--line); padding: 11px 16px max(11px, env(safe-area-inset-bottom)); }
    .save-actions button { width: 100%; min-height: 46px; }
    .skills-settings .card { padding: 16px; }
    fieldset { gap: 16px; }
    .library-field { display: grid; }
    .library-field button, .add-destination { min-height: 44px; }
    .presets, .destination { grid-template-columns: minmax(0, 1fr); }
    .destinations .section-heading { display: contents; }
    .add-destination { order: 1; }
  }
</style>
