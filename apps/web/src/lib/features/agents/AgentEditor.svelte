<script lang="ts">
  import { AUTONOMY_ACTIONS, DEFAULT_AUTONOMY, type AgentInput, type AutonomyLevel } from "@wiki-agents/contracts/agents/model";
  import { beforeNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import { agentEditorHref, wikiAgentsDestination } from "./leave.ts";
  import { onDestroy, untrack } from "svelte";
  import { providers } from "#lib/features/threads/providers.svelte.ts";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";
  import { AgentEditor } from "./agent-editor.svelte.ts";
  import { describeSources, type FormField } from "./agent-form.ts";
  import { agents } from "./agents.svelte.ts";
  import { ModelDiscovery } from "./model-discovery.svelte.ts";
  import { ACTION_LABEL, LEVEL_LABEL } from "./autonomy.ts";
  import InstructionDraft from "./InstructionDraft.svelte";
  import SourcesPicker from "./SourcesPicker.svelte";
  import TextDiff from "./TextDiff.svelte";
  import Button from "#lib/ui/primitives/Button.svelte";

  /** Edits `agentId`'s file, or creates a new agent when it is null. */
  let { agentId, onclose }: { agentId: string | null; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const editor = new AgentEditor(agentId);

  $effect(() => {
    void editor.load();
    void providers.load();
    void vaults.load();
    void agents.load();
  });

  let drafting = $state(false);
  const discovery = new ModelDiscovery();
  onDestroy(() => discovery.close());
  const configuredModels = $derived(discovery.get(editor.form.provider ?? undefined));
  const models = $derived(configuredModels?.status === "ready" ? configuredModels.result.models : []);
  const defaultModel = $derived(configuredModels?.status === "ready" ? configuredModels.result.defaultModel : null);
  $effect(() => {
    const id = editor.form.provider;
    if (id !== null) untrack(() => discovery.load(id, true));
  });

  /** Set once leaving on purpose (after saving, deleting, or Cancel's own question), so it isn't asked again. */
  let leaving = false;
  /** Unsaved changes ask before leaving, in the app and when closing the tab. */
  beforeNavigate((navigation) => {
    if (editor.dirty && !editor.saving && !leaving && !confirm("Leave without saving your changes to this agent?")) navigation.cancel();
  });

  const close = () => {
    if (editor.dirty && !confirm("Leave without saving your changes to this agent?")) return;
    leaving = true;
    onclose();
  };

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    const wasNew = editor.isNew;
    const saved = await editor.save();
    if (saved) drafting = false;
    if (saved && wasNew && editor.savedId !== null) {
      leaving = true;
      await goto(agentEditorHref("edit", editor.savedId, wikiAgentsDestination(page.url)), { replaceState: true });
      leaving = false;
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the ${editor.form.name || editor.savedId} agent? Its file goes to the config folder's .trash/; threads using it will ask for another agent.`)) return;
    if (await editor.remove()) {
      close();
    }
  };

  const problems = (field: FormField) => editor.problems[field] ?? [];

  const FIELD_LABEL: Readonly<Record<keyof AgentInput, string>> = {
    name: "Name",
    description: "Description",
    provider: "Provider",
    model: "Model",
    sources: "Knowledge sources",
    mcp: "MCP servers",
    workers: "Child thread workers",
    autonomy: "Autonomy",
    instructions: "Instructions",
  };
  const shownValue = (input: AgentInput, field: keyof AgentInput): string => {
    const value = input[field];
    if (field === "sources") return describeSources(input.sources);
    if (field === "autonomy") return AUTONOMY_ACTIONS.map((action) => `${ACTION_LABEL[action]}: ${LEVEL_LABEL[input.autonomy[action] ?? DEFAULT_AUTONOMY[action]]}`).join(" · ");
    if (field === "provider") return value === null ? "The one picked for each thread" : (providers.get(value as string)?.name ?? String(value));
    if (field === "workers") return input.workers == null ? "Any agent" : ["This agent", ...input.workers].join(", ");
    if (field === "model") return value === null ? "The provider's default" : String(value);
    return String(value) || "(empty)";
  };

  const conflictFields = $derived(
    editor.conflict?.disk == null
      ? []
      : (Object.keys(FIELD_LABEL) as Array<keyof AgentInput>).filter((field) => JSON.stringify(editor.conflict!.disk!.input[field]) !== JSON.stringify(editor.form[field])),
  );

  const saved = $derived(agents.get(editor.savedId));
  const enforcing = $derived((saved?.enforcement ?? []).filter((entry) => entry.autonomy !== null));
  const notes = $derived((saved?.enforcement ?? []).flatMap((entry) => entry.notes.map((note) => ({ provider: providers.get(entry.providerInstanceId)?.name ?? entry.providerInstanceId, note }))));
  const LEVELS: ReadonlyArray<AutonomyLevel> = ["allow", "ask", "deny"];
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (editor.dirty) event.preventDefault();
  }}
/>

<div class="editor-page">
  <header>
    <Button class="back" aria-label="Back" onclick={close}>←</Button>
    <h1>{editor.isNew ? "New agent" : `Edit ◆ ${editor.base?.input.name ?? editor.savedId}`}</h1>
  </header>

  {#if editor.status === "loading"}
    <p class="muted">Loading…</p>
  {:else if editor.status === "missing"}
    <p class="error" role="alert">There is no agent “{agentId}”; its file may have been deleted or can't be loaded (see the agents list).</p>
  {:else if editor.status === "failed"}
    <p class="error" role="alert">{editor.loadError}</p>
  {:else}
    {#if editor.conflict}
      <section class="conflict" aria-label="Changed on disk">
        <h2>The file changed on disk since you opened it</h2>
        {#if editor.conflict.disk === null}
          <p>It has been deleted (on another machine, or by hand). Save to create it again with your version.</p>
        {:else}
          <p>Someone changed it on another machine or by hand. Where it differs from yours:</p>
          <dl>
            {#each conflictFields as field (field)}
              <dt>{FIELD_LABEL[field]}</dt>
              <dd>
                {#if field === "instructions"}
                  <TextDiff before={editor.conflict.disk.input.instructions} after={editor.form.instructions} label="Instructions: on disk, then yours" />
                {:else}
                  <span class="disk">On disk: {shownValue(editor.conflict.disk.input, field)}</span>
                  <span class="mine">Yours: {shownValue(editor.form, field)}</span>
                {/if}
              </dd>
            {:else}
              <dd>Nothing you can see here; only comments or other settings in the file.</dd>
            {/each}
          </dl>
        {/if}
        <div class="actions">
          <Button variant="primary" disabled={editor.saving} onclick={() => void editor.keepMine()}>
            {editor.conflict.disk === null ? "Save mine again" : "Save mine over it"}
          </Button>
          <Button disabled={editor.saving} onclick={() => editor.useDisk()}>
            {editor.conflict.disk === null ? "Discard mine" : "Use the disk version"}
          </Button>
        </div>
      </section>
    {/if}

    {#key editor.base?.hash}
      <form class="agent-form" onsubmit={save} aria-label={editor.isNew ? "New agent" : "Edit agent"} novalidate>
        {#each problems("form") as problem (problem)}<p class="error" role="alert">{problem}</p>{/each}

        <div class="row">
          <label>
            Name
            <input value={editor.form.name} oninput={(event) => editor.setName(event.currentTarget.value)} required autocapitalize="words" />
            {#each problems("name") as problem (problem)}<span class="field-error">{problem}</span>{/each}
          </label>
          {#if editor.isNew}
            <label>
              File name
              <span class="file">
                <span class="mono">agents/</span><input class="mono" value={editor.id} oninput={(event) => editor.setId(event.currentTarget.value)} spellcheck="false" autocapitalize="off" aria-label="File name" /><span class="mono">.md</span>
              </span>
              {#each problems("id") as problem (problem)}<span class="field-error">{problem}</span>{/each}
            </label>
          {/if}
        </div>

        <label>
          Description
          <input bind:value={editor.form.description} placeholder="One line: what it is for" />
        </label>

        <div class="row">
          <label>
            Provider
            <select
              value={editor.form.provider ?? ""}
              onchange={(event) => {
                editor.form.provider = event.currentTarget.value === "" ? null : event.currentTarget.value;
                editor.form.model = null;
              }}
            >
              <option value="">The one picked for each thread</option>
              {#each providers.list as provider (provider.id)}
                <option value={provider.id}>{provider.name}</option>
              {/each}
              {#if editor.form.provider !== null && providers.list.length > 0 && !providers.get(editor.form.provider)}
                <option value={editor.form.provider}>{editor.form.provider} (not available)</option>
              {/if}
            </select>
            {#each problems("provider") as problem (problem)}<span class="field-error">{problem}</span>{/each}
          </label>
          <label>
            Model
            <input
              class="mono"
              list="agent-models"
              value={editor.form.model ?? ""}
              oninput={(event) => (editor.form.model = event.currentTarget.value.trim() === "" ? null : event.currentTarget.value)}
              disabled={editor.form.provider === null}
              placeholder={editor.form.provider === null ? "Pick a provider first" : `The provider's default${defaultModel ? ` (${defaultModel})` : ""}`}
              spellcheck="false"
              autocapitalize="off"
            />
            <datalist id="agent-models">
              {#each models as model (model.id)}<option value={model.id}>{model.name}{model.free ? " · free" : ""}</option>{/each}
            </datalist>
            {#each problems("model") as problem (problem)}<span class="field-error">{problem}</span>{/each}
          </label>
        </div>

        <fieldset class="autonomy">
          <legend>Autonomy: what it may do without asking</legend>
          {#each AUTONOMY_ACTIONS as action (action)}
            <div class="level-row" role="radiogroup" aria-label={ACTION_LABEL[action]}>
              <span class="action">{ACTION_LABEL[action]}</span>
              <span class="levels">
                {#each LEVELS as level (level)}
                  <label class="level" data-level={level}>
                    <input type="radio" name="autonomy-{action}" value={level} bind:group={editor.form.autonomy[action]} />
                    {LEVEL_LABEL[level]}
                  </label>
                {/each}
              </span>
            </div>
          {/each}
          {#each problems("autonomy") as problem (problem)}<span class="field-error">{problem}</span>{/each}
          <label>
            <input type="checkbox" checked={editor.form.workers != null} onchange={(event) => (editor.form.workers = event.currentTarget.checked ? [] : null)} />
            Restrict child thread workers
          </label>
          {#if editor.form.workers != null}
            <span>This agent can always be selected when child threads are allowed.</span>
            {#each [...new Set([...agents.list.map((agent) => agent.id), ...editor.form.workers])].filter((id) => id !== editor.id) as id (id)}
              <label>
                <input type="checkbox" checked={editor.form.workers.includes(id)} onchange={(event) => {
                  const workers = editor.form.workers ?? [];
                  editor.form.workers = event.currentTarget.checked ? [...workers, id] : workers.filter((worker) => worker !== id);
                }} />
                {agents.get(id)?.name ?? id}
              </label>
            {/each}
          {:else}
            <span>Any configured agent can be selected when child threads are allowed.</span>
          {/if}
          {#each problems("workers") as problem (problem)}<span class="field-error">{problem}</span>{/each}
          {#if enforcing.length > 0 || notes.length > 0}
            <details class="enforced">
              <summary>What each provider enforces (as saved)</summary>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      {#each enforcing as entry (entry.providerInstanceId)}<th scope="col">{providers.get(entry.providerInstanceId)?.name ?? entry.providerInstanceId}</th>{/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each AUTONOMY_ACTIONS as action (action)}
                      <tr>
                        <th scope="row">{ACTION_LABEL[action]}</th>
                        {#each enforcing as entry (entry.providerInstanceId)}
                          {@const level = entry.autonomy?.[action] ?? DEFAULT_AUTONOMY[action]}
                          <td data-level={level}>{LEVEL_LABEL[level]}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              {#if notes.length > 0}
                <ul class="notes">
                  {#each notes as { provider, note }, index (index)}<li><strong>{provider}:</strong> {note}</li>{/each}
                </ul>
              {/if}
            </details>
          {/if}
        </fieldset>

        <label>
          MCP servers
          <input
            aria-label="MCP servers"
            value={editor.form.mcp.join(", ")}
            onchange={(event) => (editor.form.mcp = event.currentTarget.value.split(/[,\s]+/).filter(Boolean))}
            placeholder="coffee-journal, github"
            spellcheck="false"
            autocapitalize="off"
          />
          <span class="hint">Server IDs from Settings › MCP servers, separated by commas. Servers enabled for every thread are included automatically.</span>
          {#each problems("mcp") as problem (problem)}<span class="field-error">{problem}</span>{/each}
        </label>

        <SourcesPicker bind:sources={editor.form.sources} vaults={vaults.list} />
        {#each problems("sources") as problem (problem)}<span class="field-error">{problem}</span>{/each}

        <label>
          Instructions
          <textarea class="mono" bind:value={editor.form.instructions} rows="16" spellcheck="true" placeholder="# Role&#10;&#10;What it does, how, and what it never does."></textarea>
          {#each problems("instructions") as problem (problem)}<span class="field-error">{problem}</span>{/each}
        </label>
        {#if drafting}
          <InstructionDraft {discovery} input={editor.form} canRevise={!editor.isNew}
            onapply={(instructions) => {
              editor.form.instructions = instructions;
              drafting = false;
            }}
            ondiscard={() => (drafting = false)}
          />
        {:else}
          <div class="actions">
            <Button onclick={() => (drafting = true)}>Draft instructions</Button>
          </div>
        {/if}
        <p class="hint">Rules files and a vault's own AGENTS.md are added for every agent. Threads use a saved change from their next message.</p>

        <div class="actions">
          <Button type="submit" variant="primary" disabled={editor.saving || (!editor.dirty && !editor.isNew) || editor.conflict !== null}>
            {editor.saving ? "Saving…" : editor.isNew ? "Create agent" : "Save"}
          </Button>
          <Button onclick={close}>{editor.dirty ? "Cancel" : "Done"}</Button>
          {#if !editor.isNew}
            <Button danger class="delete" disabled={editor.saving} onclick={() => void remove()}>Delete</Button>
          {/if}
          <span class="status" role="status">{editor.dirty ? "Unsaved changes" : editor.isNew ? "" : "Saved"}</span>
        </div>
        {#if editor.savedId}<p class="hint mono path">{saved?.path ?? ""}</p>{/if}
      </form>
    {/key}
  {/if}
</div>

<style>
  .editor-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px 16px 40px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--agent);
  }
  header > :global(.back) {
    flex: 0 0 auto;
    width: 34px;
    padding: 0;
  }
  .agent-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 13px;
    color: var(--ink-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .row > label {
    flex: 1 1 220px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--ink-3);
  }
  .file input {
    flex: 1 1 auto;
    min-width: 0;
  }
  input:not([type="radio"], [type="checkbox"]),
  select,
  textarea {
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  textarea.mono {
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .level-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line-soft);
    font-size: 14px;
  }
  .levels {
    display: flex;
    gap: 4px;
  }
  .level {
    flex-direction: row;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink-2);
    font-size: 13px;
    cursor: pointer;
  }
  .level:has(input:checked)[data-level="allow"] {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .level:has(input:checked)[data-level="ask"] {
    border-color: var(--agent);
    color: var(--agent);
  }
  .level:has(input:checked)[data-level="deny"] {
    border-color: var(--del);
    color: var(--del);
  }
  .level input {
    margin: 0;
  }
  .enforced {
    margin-top: 8px;
    font-size: 13px;
  }
  .enforced summary {
    color: var(--ink-2);
    cursor: pointer;
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    margin-top: 6px;
  }
  th,
  td {
    padding: 4px 12px 4px 0;
    border-bottom: 1px solid var(--line-soft);
    text-align: left;
    font-weight: 400;
    white-space: nowrap;
  }
  td[data-level="allow"] {
    color: var(--accent-ink);
  }
  td[data-level="ask"] {
    color: var(--agent);
  }
  td[data-level="deny"] {
    color: var(--del);
  }
  .notes {
    margin: 6px 0 0;
    padding-left: 1.1em;
    color: var(--ink-2);
  }
  .conflict {
    margin-bottom: 16px;
    padding: 12px 14px;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .conflict h2 {
    margin: 0 0 6px;
    font-size: 14px;
    color: var(--warn);
  }
  .conflict p {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .conflict dl {
    margin: 0 0 10px;
    font-size: 13px;
  }
  .conflict dt {
    margin-top: 8px;
    color: var(--ink-3);
  }
  .conflict dd {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 0 0;
    overflow-wrap: anywhere;
  }
  .disk {
    color: var(--del);
  }
  .mine {
    color: var(--ok);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .actions > :global(.delete) {
    margin-left: auto;
    color: var(--del);
  }
  .status {
    font-size: 12px;
    color: var(--ink-3);
  }
  .hint,
  .muted {
    margin: 0;
    font-size: 12px;
    color: var(--ink-3);
  }
  .path {
    word-break: break-all;
  }
  .error,
  .field-error {
    margin: 0;
    color: var(--del);
  }
  .field-error {
    font-size: 12px;
  }
  @media (max-width: 899px) {
    input:not([type="radio"], [type="checkbox"]),
    select,
    textarea {
      font-size: 16px;
    }
  }
</style>
