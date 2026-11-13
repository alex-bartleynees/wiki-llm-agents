<script lang="ts">
  import { AUTONOMY_ACTIONS, type AgentSummary } from "@wiki-agents/contracts/agents/model";
  import { errorMessage, isAbort } from "#lib/api/client.ts";
  import { providers } from "#lib/features/threads/providers.svelte.ts";
  import { describeSources } from "./agent-form.ts";
  import { getAgent } from "./api.ts";
  import { ACTION_LABEL, LEVEL_LABEL } from "./autonomy.ts";

  let { agent, onback }: { agent: AgentSummary; onback: () => void } = $props();

  let instructions = $state<string | undefined>(undefined);
  let error = $state<string | undefined>(undefined);

  $effect(() => {
    const controller = new AbortController();
    instructions = undefined;
    error = undefined;
    getAgent(agent.id, controller.signal).then(
      (response) => (instructions = response.instructions),
      (failure) => {
        if (!isAbort(failure)) error = errorMessage(failure, "Couldn't load the instructions");
      },
    );
    return () => controller.abort();
  });

  /** Providers that run tools, so enforce autonomy; replay runs none. */
  const enforcing = $derived(agent.enforcement.filter((entry) => entry.autonomy !== null));
  const notes = $derived(
    agent.enforcement.flatMap((entry) => entry.notes.map((note) => ({ provider: providers.get(entry.providerInstanceId)?.name ?? entry.providerInstanceId, note }))),
  );
  const providerName = (id: string) => providers.get(id)?.name ?? id;
</script>

<header>
  <button type="button" class="back" aria-label="All agents" onclick={onback}>←</button>
  <h2>◆ {agent.name}</h2>
  <a class="edit" href="/agents/edit?agent={encodeURIComponent(agent.id)}">Edit</a>
</header>

<div class="body">
  {#if agent.description}<p class="description">{agent.description}</p>{/if}

  <dl>
    <dt>Provider</dt>
    <dd>{agent.provider === null ? "The one you pick" : providerName(agent.provider)}</dd>
    <dt>Model</dt>
    <dd class:mono={agent.model !== null}>{agent.model ?? "The provider's default"}</dd>
    <dt>Sources</dt>
    <dd>{describeSources(agent.sources)}</dd>
    <dt>File</dt>
    <dd class="mono path">{agent.path}</dd>
  </dl>

  <h3>Autonomy</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Action</th>
          <th scope="col">The file says</th>
          {#each enforcing as entry (entry.providerInstanceId)}
            <th scope="col">{providerName(entry.providerInstanceId)} does</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each AUTONOMY_ACTIONS as action (action)}
          <tr>
            <th scope="row">{ACTION_LABEL[action]}</th>
            <td data-level={agent.autonomy[action]}>{LEVEL_LABEL[agent.autonomy[action]]}</td>
            {#each enforcing as entry (entry.providerInstanceId)}
              {@const level = entry.autonomy?.[action] ?? agent.autonomy[action]}
              <td data-level={level} class:differs={level !== agent.autonomy[action]}>{LEVEL_LABEL[level]}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if notes.length > 0}
    <ul class="notes">
      {#each notes as { provider, note }, index (index)}
        <li><strong>{provider}:</strong> {note}</li>
      {/each}
    </ul>
  {/if}

  <h3>Instructions</h3>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if instructions === undefined}
    <p class="muted">Loading…</p>
  {:else}
    <pre class="instructions">{instructions}</pre>
  {/if}
  <p class="muted">Edit the agent here or its file; threads use the new version from their next message.</p>
</div>

<style>
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line-soft);
  }
  .back {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .edit {
    margin-left: auto;
    padding: 5px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: 13px;
    text-decoration: none;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--agent);
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 12px 16px 24px;
  }
  .description {
    margin: 0 0 12px;
    color: var(--ink-2);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0 0 16px;
    font-size: 13px;
  }
  dt {
    color: var(--ink-3);
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  .path {
    font-size: 11px;
    word-break: break-all;
  }
  h3 {
    margin: 18px 0 8px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    padding: 5px 8px 5px 0;
    border-bottom: 1px solid var(--line-soft);
    text-align: left;
    white-space: nowrap;
  }
  thead th {
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-3);
  }
  tbody th {
    font-weight: 400;
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
  td.differs {
    font-weight: 600;
  }
  .notes {
    margin: 8px 0 0;
    padding-left: 1.1em;
    font-size: 12px;
    color: var(--ink-2);
  }
  .instructions {
    margin: 0 0 8px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--sunken);
    font: 12px/1.5 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .muted {
    font-size: 12px;
    color: var(--ink-3);
  }
  .error {
    color: var(--del);
  }
</style>
