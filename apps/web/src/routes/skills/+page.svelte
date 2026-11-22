<script lang="ts">
  import { beforeNavigate } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import type { Detail, InstallAction, InstallTarget, Review, Settings, SettingsPreview } from "@wiki-agents/contracts/skills/model";
  import type { GetSettingsResponse } from "@wiki-agents/contracts/skills/get-settings/response";
  import type { ListSkillsResponse } from "@wiki-agents/contracts/skills/list-skills/response";
  import { ApiError, errorMessage } from "#lib/api/client.ts";
  import TextDiff from "#lib/features/agents/TextDiff.svelte";
  import { machineFolders } from "#lib/features/folders/api.ts";
  import FolderPicker from "#lib/ui/primitives/FolderPicker.svelte";
  import SkillSettings from "#lib/features/skills/SkillSettings.svelte";
  import * as api from "#lib/features/skills/api.ts";
  import "#lib/features/skills/skills.css";

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
  let installs = $state<HTMLElement>();
  let showSettings = $state(false);
  let busy = $state(false);
  let error = $state("");
  let notice = $state("");
  let query = $state("");
  let name = $state("");
  let importPath = $state("");
  let pickingImport = $state(false);
  let editor = $state.raw<typeof import("#lib/features/skills/SkillSource.svelte").default>();
  let editing = $state(false);
  let draft = $state("");
  let review = $state.raw<{ action: InstallAction; destination: string; diff: Review } | null>(null);
  const installLabels = {
    installed: "Up to date",
    "update available": "Update available",
    "external installed": "Installed",
    "external differs": "Installed",
    unmanaged: "Unmanaged conflict",
    conflict: "Conflict",
    modified: "Locally modified",
    missing: "Missing install",
    absent: "Not installed",
  } satisfies Record<InstallTarget["status"], string>;
  const installCounts = $derived(
    Object.entries(installLabels).flatMap(([status, label]) => {
      if (status === "external differs") return [];
      const count = selected?.targets.filter((target) =>
        target.status === status || (status === "external installed" && target.status === "external differs"),
      ).length ?? 0;
      return count ? [{ status, label, count }] : [];
    }),
  );
  const differenceLabels = {
    content: "Content differs",
    permissions: "Permissions differ",
    "entry type": "File or directory type differs",
    "only installed": "Only in the installed copy",
    "only library": "Only in the library",
  } as const;
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
  const visible = $derived(catalog.skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())));
  const visibleProblems = $derived(catalog.problems.filter((entry) => (entry.path + " " + entry.message).toLowerCase().includes(query.trim().toLowerCase())));
  const filters = [
    { id: "all", label: "All" },
    { id: "valid", label: "Valid" },
    { id: "problems", label: "Needs attention" },
  ] as const;
  const resultCount = $derived((filter === "problems" ? 0 : visible.length) + (filter === "valid" ? 0 : visibleProblems.length));
  const showLineDiff = (before: string, after: string) => before.split("\n").length * after.split("\n").length < 1_000_000;

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
    if (busy) return;
    busy = true;
    error = "";
    notice = "";
    try {
      await operation();
    } catch (cause) {
      error = errorMessage(cause, "Skills operation failed.");
    } finally {
      busy = false;
    }
  }

  async function refreshCatalog() {
    catalog = await api.listSkills("");
  }

  function select(detail: Detail | null) {
    selected = detail;
    draft = detail?.content ?? "";
    editing = false;
    disk = null;
    review = null;
  }

  async function startEditing() {
    if (editor === undefined) editor = (await import("#lib/features/skills/SkillSource.svelte")).default;
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

  function createSkill() {
    void run(async () => {
      select(await api.saveSkill({ skillPath: name, content: "", baseHash: null }));
      name = "";
      author = null;
      filter = "all";
      query = "";
      await refreshCatalog();
      await startEditing();
      await revealDetail();
    });
  }

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
    installs?.scrollIntoView({ block: "start" });
    installs?.focus({ preventScroll: true });
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
          <button type="button" class="settings-action" aria-label="Skills settings" disabled={busy || editing} onclick={() => (showSettings = true)}>Settings</button>
          <button type="button" class="primary new-skill" disabled={busy || editing} aria-expanded={author === "create"} onclick={() => (author = author === "create" ? null : "create")}>+ New skill</button>
        </div>
      </div>
      {#if author === "create"}
        <form class="author-form" onsubmit={(event) => { event.preventDefault(); createSkill(); }}>
          <label>New skill name <input bind:value={name} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="64" /></label>
          <button class="primary" disabled={busy || editing}>Create skill</button>
        </form>
      {:else if author === "import"}
        <form class="author-form" onsubmit={(event) => { event.preventDefault(); void run(async () => {
          select(await api.importSkill({ path: importPath }));
          importPath = "";
          query = "";
          author = null;
          filter = "all";
          await refreshCatalog();
          await revealDetail();
        }); }}>
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
      <button class="primary" onclick={() => (showSettings = true)}>Set up Skills</button>
    {/if}
  </header>
  <div class="library-feedback">{@render feedback()}</div>

  {#if settings?.settings}
    <div class="layout">
      <section class="catalog" aria-label="Skills library">
        <input type="search" aria-label="Search skills" placeholder="Search skills" bind:value={query} />
        <div class="filters" role="group" aria-label="Filter skills">
          {#each filters as item}
            <button type="button" aria-pressed={filter === item.id} onclick={() => (filter = item.id)}>
              {item.label} {item.id === "all" ? visible.length + visibleProblems.length : item.id === "valid" ? visible.length : visibleProblems.length}
            </button>
          {/each}
        </div>
        <div class="results" role="region" aria-label="Skill results">
          {#if filter !== "problems"}
            {#each visible as skill (skill.skillPath)}
              <button class="skill" type="button" aria-pressed={selected?.skillPath === skill.skillPath} disabled={busy} onclick={() => openSkill(skill.skillPath)}>
                <strong>{skill.name}</strong>
                <span>{skill.description}</span>
                {#if skill.skillPath !== skill.name}<code title={skill.skillPath}>{skill.skillPath}</code>{/if}
              </button>
            {/each}
          {/if}
          {#if filter !== "valid"}
            {#each visibleProblems as problem}
              <div class="skill problem">
                <div><strong title={problem.path}>{problem.path.split("/").at(-1)}</strong><span class="badge">Needs attention</span></div>
                <p>{problem.message}</p>
              </div>
            {/each}
          {/if}
          {#if !resultCount}<p class="muted empty">No matching skills.</p>{/if}
        </div>
      </section>

      {#if selected}
        <section class="detail" aria-label="Skill detail">
          <div class="mobile-back"><button type="button" disabled={busy} onclick={backToSkills}>← Skills</button></div>
          <div class="detail-header">
            <div>
              <div class="title-line"><h2 tabindex="-1" bind:this={detailHeading}>{selected.name}</h2>{#if selected.version}<code class="version">{selected.version}</code>{/if}<span class="badge valid">✓ Valid</span></div>
              <p class="description">{selected.description}</p>
              <div class="path-chip source-path">
                <code title={selected.path + "/SKILL.md"}>{selected.skillPath}/SKILL.md</code>
                <button class="text-button" type="button" disabled={busy} onclick={() => selected && copyPath(selected.path + "/SKILL.md")}>Copy</button>
              </div>
            </div>
            {#if !editing}
              <div class="buttons detail-actions">
                <output class="install-summary" data-status={installCounts.length > 1 ? "mixed" : installCounts[0]?.status} aria-label="Install status">{installSummary}</output>
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
            <div class="source-column">
              {#if editing && editor}
                {@const SkillEditor = editor}
                <fieldset disabled={busy}>
                  <legend>Edit SKILL.md</legend>
                  <SkillEditor readOnly={busy} content={draft} change={(text: string) => (draft = text)} save={() => saveDraft()} />
                  <div class="buttons">
                    <button class="primary" disabled={!dirty || disk !== null} onclick={() => saveDraft()}>Save SKILL.md</button>
                    <button onclick={() => select(selected)}>Cancel edit</button>
                  </div>
                  {#if disk}
                    <p>SKILL.md changed on disk. Compare your draft with the disk version.</p>
                    {#if showLineDiff(draft, disk.content)}
                      <TextDiff before={draft} after={disk.content} label="Draft compared with disk" />
                    {:else}
                      <pre>{disk.content}</pre>
                    {/if}
                    <div class="buttons">
                      <button onclick={() => select(disk)}>Use disk version</button>
                      <button onclick={() => saveDraft(disk?.hash)}>Save my draft over this disk version</button>
                    </div>
                  {/if}
                </fieldset>
              {:else}
                <div class="preview">
                  <div class="preview-header"><code>SKILL.md</code><span>Read only</span></div>
                  <pre aria-label="SKILL.md preview">{#each selected.content.split("\n") as line, index}<span class="source-line" class:heading-line={line.startsWith("#")}><span class="line-number" aria-hidden="true">{index + 1}</span><span>{line || " "}</span></span>{/each}</pre>
            </div>
          {/if}

            </div>
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
              <section class="card installations" aria-label="Install destinations" tabindex="-1" class:empty-installs={!selected.targets.length} bind:this={installs}>
                <h3>Install destinations</h3>
                {#each selected.targets as target (target.path)}
                  <div class="target">
                    <strong>{target.destination.labels.join(" · ")}</strong>
                    <code>{target.path}</code>
                    <span class="install-status" data-status={target.status}>{installLabels[target.status]}</span>
                    {#if target.status === "external installed" || target.status === "external differs"}<p>Managed outside wiki-agents</p>{/if}
                    {#if target.differences?.length}
                      <div class="install-differences" role="group" aria-label="Differences from library">
                        <strong>Differences from library</strong>
                        <ul>
                          {#each target.differences as difference (difference.path)}
                            <li><code>{difference.path}</code> · {difference.kinds.map((kind) => differenceLabels[kind]).join(", ")}</li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                    {#if target.problem}<span>{target.problem}</span>{/if}
                    {#if target.needsRecovery}<button type="button" disabled={busy || editing} onclick={() => recover(target.destination.path)}>Recover install</button>{/if}
                    <div class="buttons">
                      {#each target.actions as action}
                        <button disabled={editing || busy} onclick={() => prepare(action, target.destination.path)}>Review {action}</button>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <p>Add a destination in Skills settings to install this skill.</p>
                  <button type="button" class="text-button" disabled={busy || editing} onclick={() => (showSettings = true)}>Add destination →</button>
                {/each}
              </section>
            </aside>
            {#if review}
              <section class="card install-review" aria-label="Install review">
                <h3>Review {review.action}</h3>
                <code>{review.diff.path}</code>
                {#if showLineDiff(review.diff.before, review.diff.after)}
                  <TextDiff before={review.diff.before} after={review.diff.after} label="SKILL.md changes" />
                {:else}
                  <details><summary>Current SKILL.md</summary><pre>{review.diff.before}</pre></details>
                  <details><summary>Proposed SKILL.md</summary><pre>{review.diff.after}</pre></details>
                {/if}
                <ul>
                  {#each review.diff.files as file}
                    <li>{file.kind} <code>{file.path}</code></li>
                  {/each}
                </ul>
                <div class="buttons">
                  <button class="primary" disabled={busy || editing} onclick={apply}>Confirm {review.action}</button>
                  <button onclick={() => (review = null)}>Cancel review</button>
                </div>
              </section>
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
