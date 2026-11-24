<script lang="ts">
  import { beforeNavigate } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import type { Detail, InstallAction, Review, Settings, SettingsPreview } from "@wiki-agents/contracts/skills/model";
  import type { GetSettingsResponse } from "@wiki-agents/contracts/skills/get-settings/response";
  import type { ListSkillsResponse } from "@wiki-agents/contracts/skills/list-skills/response";
  import { ApiError, errorMessage } from "#lib/api/client.ts";
  import "./skills.css";
  import * as api from "./api.ts";
  import { installLabels } from "./install-labels.ts";
  import InstallStatus from "./InstallStatus.svelte";
  import PathChip from "./PathChip.svelte";
  import SkillCatalog from "./SkillCatalog.svelte";
  import SkillInstallReview from "./SkillInstallReview.svelte";
  import SkillInstalls from "./SkillInstalls.svelte";
  import SkillLibraryHeader from "./SkillLibraryHeader.svelte";
  import SkillSettings from "./SkillSettings.svelte";
  import SkillSourcePanel from "./SkillSourcePanel.svelte";

  let settings = $state.raw<GetSettingsResponse | null>(null);
  let catalog = $state.raw<ListSkillsResponse>({ skills: [], problems: [] });
  let detailHeading = $state<HTMLHeadingElement>();
  let selected = $state.raw<Detail | null>(null);
  let disk = $state.raw<Detail | null>(null);
  let previewGeneration = 0;
  let previewError = $state("");
  let resolved = $state.raw<SettingsPreview | null>(null);
  let filter = $state<"all" | "valid" | "problems">("all");
  let mobileDetail = $state(false);
  let panel = $state<"source" | "details" | "install">("source");
  let author = $state<"create" | "import" | null>(null);
  let installs = $state<SkillInstalls>();
  let showSettings = $state(false);
  let busy = $state(false);
  let error = $state("");
  let notice = $state("");
  let query = $state("");
  let editor = $state.raw<typeof import("./SkillSource.svelte").default>();
  let editing = $state(false);
  let draft = $state("");
  let review = $state.raw<{ action: InstallAction; destination: string; diff: Review } | null>(null);
  const installCounts = $derived(
    Object.entries(installLabels).flatMap(([status, label]) => {
      if (status === "external differs") return [];
      const count = selected?.targets.filter((target) =>
        target.status === status || (status === "external installed" && target.status === "external differs"),
      ).length ?? 0;
      return count ? [{ status, label, count }] : [];
    }),
  );
  const managed = $derived(selected?.targets.some(({ status }) =>
    status !== "absent" && status !== "unmanaged" && status !== "conflict",
  ) ?? false);
  const installSummary = $derived.by(() => {
    const [only] = installCounts;
    if (!only) return "No destinations";
    if (installCounts.length === 1) return only.count === 1 ? only.label : only.label + " · " + only.count + " destinations";
    return "Mixed · " + installCounts.map(({ count, label }) => count + " " + label.toLowerCase()).join(", ");
  });
  const dirty = $derived(editing && selected !== null && selected.content !== draft);

  beforeNavigate((navigation) => {
    if (dirty && !window.confirm("Discard unsaved skill edits?")) navigation.cancel();
  });

  onMount(() => { void run(async () => {
    settings = await api.getSettings();
    showSettings = settings.settings === null;
    await refreshCatalog();
    const first = catalog.skills[0];
    if (first && !window.matchMedia("(max-width: 699px)").matches) select(await api.getSkill(first.skillPath));
  }); });

  async function run(operation: () => Promise<void>) {
    if (busy) return false;
    busy = true;
    error = "";
    notice = "";
    try {
      await operation();
      return true;
    } catch (cause) {
      error = errorMessage(cause, "Skills operation failed.");
      return false;
    } finally {
      busy = false;
    }
  }

  async function refreshCatalog() {
    catalog = await api.listSkills();
  }

  function select(detail: Detail | null) {
    selected = detail;
    draft = detail?.content ?? "";
    editing = false;
    disk = null;
    review = null;
  }

  async function startEditing() {
    if (editor === undefined) editor = (await import("./SkillSource.svelte")).default;
    editing = true;
  }

  async function revealDetail() {
    mobileDetail = true;
    panel = "source";
    await tick();
    if (window.matchMedia("(max-width: 699px)").matches) detailHeading?.focus();
  }

  function openSkill(next: string) {
    if (dirty && !window.confirm("Discard unsaved skill edits?")) return;
    void run(async () => {
      select(await api.getSkill(next));
      await revealDetail();
    });
  }

  const added = async (detail: Detail) => {
    select(detail);
    author = null;
    filter = "all";
    query = "";
    await refreshCatalog();
  };

  const createSkill = (name: string) => run(async () => {
    await added(await api.saveSkill({ skillPath: name, content: "", baseHash: null }));
    await startEditing();
    await revealDetail();
  });

  const importSkill = (path: string) => run(async () => {
    await added(await api.importSkill({ path }));
    await revealDetail();
  });

  function saveDraft(baseHash = selected?.hash) {
    if (selected === null || baseHash === undefined || !dirty) return;
    const skillPath = selected.skillPath;
    void run(async () => {
      try {
        select(await api.saveSkill({ skillPath, content: draft, baseHash }));
        notice = "Saved in the library.";
        await refreshCatalog();
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) disk = await api.getSkill(skillPath).catch(() => null);
        throw cause;
      }
    });
  }

  function invalidatePreview() {
    previewGeneration++;
    previewError = "";
    resolved = null;
  }

  async function preview(value: Settings) {
    invalidatePreview();
    const generation = previewGeneration;
    try {
      const response = await api.previewSettings(value);
      if (generation === previewGeneration) resolved = response;
    } catch (cause) {
      if (generation === previewGeneration) previewError = errorMessage(cause, "Path preview failed.");
    }
  }

  function configure(value: Settings, baseHash: string | null) {
    previewGeneration++;
    previewError = "";
    void run(async () => {
      settings = await api.saveSettings({ ...value, baseHash });
      resolved = null;
      select(null);
      mobileDetail = false;
      await refreshCatalog();
      notice = "Settings saved. The paths shown are resolved on the host.";
    });
  }

  function backToSkills() {
    if (dirty && !window.confirm("Discard unsaved skill edits?")) return;
    if (editing) select(selected);
    mobileDetail = false;
  }

  function copyPath(path: string) {
    void run(async () => {
      await navigator.clipboard.writeText(path);
      notice = "Path copied.";
    });
  }

  async function showInstalls() {
    panel = "install";
    await tick();
    installs?.reveal();
  }

  function recover(destination: string) {
    if (!selected) return;
    const skillPath = selected.skillPath;
    void run(async () => {
      select(await api.recoverInstall({ skillPath, destination }));
      notice = "Install recovery complete.";
    });
  }

  function prepare(action: InstallAction, destination: string) {
    if (selected === null) return;
    const skillPath = selected.skillPath;
    review = null;
    void run(async () => {
      review = { action, destination, diff: await api.reviewInstall({ skillPath, destination, action }) };
    });
  }

  function apply() {
    if (selected === null || review === null) return;
    const { action, destination, diff } = review;
    const skillPath = selected.skillPath;
    review = null;
    void run(async () => {
      try {
        select(await api.applyInstall({ skillPath, destination, action, token: diff.token }));
        notice = "Destination updated.";
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) select(await api.getSkill(skillPath));
        throw cause;
      }
    });
  }
</script>

<svelte:head><title>{showSettings ? "Skills settings" : "Skills"} · wiki-agents</title></svelte:head>

{#snippet feedback()}
  {#if error || previewError}<p class="feedback" role="alert">{error || previewError}</p>{/if}
  {#if notice}<p class="feedback" role="status">{notice}</p>{/if}
  {#if !settings && busy}<p class="feedback" role="status">Loading Skills…</p>{/if}
{/snippet}

{#if settings && showSettings}
  {#key settings.hash}
    <SkillSettings view={settings} {busy} save={configure} {preview} {resolved} onDraftChange={invalidatePreview} close={() => { showSettings = false; invalidatePreview(); }}>
      {@render feedback()}
    </SkillSettings>
  {/key}
{:else}
<div class="skills skills-page" class:show-detail={mobileDetail && selected !== null}>
  <SkillLibraryHeader {settings} {busy} {editing} bind:author create={createSkill} importFolder={importSkill} {copyPath} openSettings={() => (showSettings = true)} />
  <div class="library-feedback">{@render feedback()}</div>

  {#if settings?.settings}
    <div class="layout">
      <SkillCatalog {catalog} selectedPath={selected?.skillPath} {busy} open={openSkill} bind:query bind:filter />

      {#if selected}
        <section class="detail" aria-label="Skill detail">
          <div class="mobile-back"><button type="button" disabled={busy} onclick={backToSkills}>← Skills</button></div>
          <div class="detail-header">
            <div>
              <div class="title-line"><h2 tabindex="-1" bind:this={detailHeading}>{selected.name}</h2>{#if selected.version}<code class="version">{selected.version}</code>{/if}<span class="badge">✓ Valid</span></div>
              <p class="description">{selected.description}</p>
              <PathChip label={selected.skillPath + "/SKILL.md"} path={selected.path + "/SKILL.md"} {busy} copy={copyPath} />
            </div>
            {#if !editing}
              <div class="buttons detail-actions">
                <InstallStatus element="output" ariaLabel="Install status" status={installCounts.length > 1 ? "mixed" : installCounts[0]?.status} text={installSummary} />
                <button type="button" disabled={busy} onclick={() => void showInstalls()}>{managed ? "Manage installs" : "Install"}</button>
                <button type="button" class="primary" disabled={busy} onclick={() => { panel = "source"; void run(startEditing); }}>Edit SKILL.md</button>
              </div>
            {/if}
          </div>
          <div class="mobile-tabs" role="group" aria-label="Skill views">
            <button type="button" aria-pressed={panel === "source"} onclick={() => (panel = "source")}>SKILL.md</button>
            <button type="button" disabled={editing} aria-pressed={panel === "details"} onclick={() => (panel = "details")}>Details</button>
            <button type="button" disabled={editing} aria-pressed={panel === "install"} onclick={() => (panel = "install")}>Install</button>
          </div>
          <div class="detail-body" data-panel={panel}>
            <SkillSourcePanel {selected} {disk} bind:draft {editing} {dirty} {busy} {editor} {saveDraft} {select} />
            <aside class="detail-sidebar">
              <div class="metadata">
                <section class="card" aria-label="Details">
                  <h3>Details</h3>
                  <dl><dt>Status</dt><dd class="valid-text">Valid</dd>{#if selected.version}<dt>Version</dt><dd><code>{selected.version}</code></dd>{/if}<dt>Folder</dt><dd><code>{selected.skillPath}</code></dd><dt>Entry file</dt><dd><code>SKILL.md</code></dd></dl>
                </section>
                <section class="card" aria-label="Supporting files">
                  <h3>Supporting files</h3>
                  {#if selected.files.length}
                    <ul>
                      {#each selected.files as path}<li><code>{path}</code></li>{/each}
                    </ul>
                  {:else}
                    <p>No supporting files.</p>
                  {/if}
                </section>
              </div>
              <SkillInstalls bind:this={installs} targets={selected.targets} {busy} {editing} {recover} {prepare} openSettings={() => (showSettings = true)} />
            </aside>
            {#if review}
              <SkillInstallReview {review} disabled={busy || editing} confirm={apply} cancel={() => (review = null)} />
            {/if}
          </div>
        </section>
      {:else}
        <p class="empty-detail muted">{catalog.skills.length ? "Select a skill to view its source and installs." : "Create or import a skill to get started."}</p>
      {/if}
    </div>
  {/if}
</div>
{/if}

<style>
  .skills {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    box-sizing: border-box;
    max-width: 1280px;
    height: 100%;
  }

  .feedback {
    margin-block: 12px;
    color: var(--ink-3);

    &[role="alert"] {
      color: var(--del);
    }
  }

  .library-feedback:empty {
    display: none;
  }

  .layout {
    display: grid;
    grid-row: 3;
    grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
    align-items: start;
    gap: 24px;
    min-height: 0;
  }

  .detail,
  .empty-detail {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--skill-radius);
    background: var(--surface);
  }

  .detail {
    box-sizing: border-box;
    height: 100%;
    overflow: auto;
  }

  .empty-detail {
    padding: 16px;
  }

  .mobile-tabs,
  .mobile-back {
    display: none;
  }

  .detail-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 18px;
    padding: 23px 24px 21px;
    border-bottom: 1px solid var(--line);
  }

  .title-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px;
  }

  .badge {
    padding: 2px 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ok) 13%, var(--surface));
    color: var(--ok);
    font-size: 12px;
    font-weight: 600;
  }

  .valid-text {
    color: var(--ok);
  }

  .version {
    padding: 2px 8px;
    border-radius: var(--radius);
    background: var(--sunken);
    color: var(--ink-2);
    font-size: 12px;
  }

  .description {
    margin-block: 10px 12px;
    color: var(--ink-2);
    font-family: var(--font-read);
    font-size: 16px;
    line-height: 1.5;
  }

  .detail-actions {
    display: grid;
    grid-template-columns: auto auto;
    justify-content: end;
  }

  .detail-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 240px);
    gap: 24px;
    padding: 24px;
  }

  .detail-sidebar,
  .metadata {
    display: grid;
    align-content: start;
    gap: 14px;
    min-width: 0;
  }

  .detail-sidebar {
    :global(h3) {
      margin-bottom: 6px;
      color: var(--ink-3);
    }

    :global(p) {
      color: var(--ink-2);
    }

    dl {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 5px 12px;
    }

    dt {
      color: var(--ink-3);
    }

    dd {
      margin: 0;
    }
  }

  .detail-actions > :global(.install-status) {
    grid-column: 1 / -1;
    justify-self: end;
    max-width: 260px;
    text-align: right;
    overflow-wrap: anywhere;
  }

  @media (max-width: 1050px) and (min-width: 700px) {
    .layout {
      grid-template-columns: minmax(190px, 250px) minmax(0, 1fr);
      gap: 16px;
    }

    .detail-body {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 699px) {
    .layout {
      display: flex;
      flex-direction: column;
    }

    .detail {
      border: 0;
      background: transparent;
    }

    .empty-detail,
    .skills:not(.show-detail) .detail {
      display: none;
    }

    .show-detail {
      height: auto;
      padding-bottom: 120px;

      :global(.catalog),
      :global(.library-header) {
        display: none;
      }

      .detail {
        height: auto;
        overflow: visible;
      }
    }

    .mobile-back {
      display: block;
      margin-bottom: 14px;

      button {
        padding-left: 0;
        border: 0;
        background: transparent;
      }
    }

    .detail-header {
      display: block;
      padding: 0;
      border: 0;
    }

    .detail-header :global(.path-chip) {
      width: 100%;
      background: var(--surface);
    }

    .mobile-tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      margin-block: 18px;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: var(--skill-radius);
      background: var(--surface);

      button {
        border-color: transparent;
        color: var(--ink-3);

        &[aria-pressed="true"] {
          background: var(--sunken);
          color: var(--ink);
          font-weight: 600;
        }
      }
    }

    .detail-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      padding: 0;

      &:not([data-panel="source"]) :global(.source-column),
      &[data-panel="source"] .detail-sidebar,
      &[data-panel="details"] :global(.installations),
      &[data-panel="install"] .metadata {
        display: none;
      }
    }

    .detail-sidebar :global(.card) {
      background: var(--surface);
    }

    .detail-actions {
      display: grid;
      grid-template-columns: 1fr 1.35fr;
      position: fixed;
      inset: auto 0 0;
      z-index: 2;
      padding: 11px 16px max(11px, env(safe-area-inset-bottom));
      border-top: 1px solid var(--line);
      background: var(--surface);

      button {
        min-height: 46px;
      }
    }

    .detail-actions > :global(.install-status) {
      justify-self: start;
      max-width: none;
      text-align: left;
    }
  }
</style>
