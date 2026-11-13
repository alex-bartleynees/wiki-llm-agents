<script lang="ts">
  import type { AgentSummary } from "@wiki-agents/contracts/agents/model";
  import type { ThreadStatus } from "@wiki-agents/contracts/threads/model";
  import { providers } from "#lib/features/threads/providers.svelte.ts";
  import { threads } from "#lib/features/threads/threads.svelte.ts";
  import AgentDetail from "./AgentDetail.svelte";
  import { agents } from "./agents.svelte.ts";
  import { describeAutonomy } from "./autonomy.ts";

  /** Opening the screen asks again, so edits to the files show up. */
  $effect(() => {
    void agents.refresh();
    void providers.load();
  });

  /** What the agent is doing in this vault's threads: waiting on you beats running beats idle. */
  const statusOf = (agent: AgentSummary): { status: ThreadStatus; count: number } => {
    const mine = threads.threads.filter((thread) => thread.agentId === agent.id);
    for (const status of ["waiting", "running"] as const) {
      const count = mine.filter((thread) => thread.status === status).length;
      if (count > 0) return { status, count };
    }
    return { status: "idle", count: mine.length };
  };

  const STATUS_TEXT = {
    waiting: (count: number) => `${count} waiting on you`,
    running: (count: number) => `${count} running`,
    idle: (count: number) => (count === 0 ? "No threads" : `Idle · ${count} thread${count === 1 ? "" : "s"}`),
  } as const;

  /** Paths inside the config directory, shown relative to it. */
  const relative = (path: string) => (agents.configDir !== null && path.startsWith(`${agents.configDir}/`) ? path.slice(agents.configDir.length + 1) : path);

  const shown = $derived(agents.get(agents.shown));
</script>

<div class="pane">
  {#if shown}
    <AgentDetail agent={shown} onback={() => (agents.shown = null)} />
  {:else}
    <header>
      <h2 class="mono">Agents</h2>
      <span class="header-actions">
        <button type="button" class="refresh" onclick={() => void agents.refresh()}>Reload</button>
        <a class="new" href="/agents/edit">New agent</a>
      </span>
    </header>

    <div class="body">
      {#if agents.error}
        <p class="error" role="alert">{agents.error}</p>
      {/if}

      {#if agents.problems.length > 0}
        <section class="problems" aria-label="Problems">
          <h3>Files that couldn't be loaded</h3>
          <ul>
            {#each agents.problems as problem (problem.path)}
              <li><span class="mono">{relative(problem.path)}</span>: {problem.message}</li>
            {/each}
          </ul>
        </section>
      {/if}

      <ul class="agents">
        {#each agents.list as agent (agent.id)}
          {@const { status, count } = statusOf(agent)}
          <li>
            <button type="button" onclick={() => (agents.shown = agent.id)}>
              <span class="top">
                <span class="name">◆ {agent.name}</span>
                <span class="status mono" data-status={status}>{STATUS_TEXT[status](count)}</span>
              </span>
              {#if agent.description}<span class="description">{agent.description}</span>{/if}
              <span class="autonomy">{describeAutonomy(agent.autonomy)}</span>
            </button>
          </li>
        {/each}
      </ul>

      <section class="rules" aria-label="Rules">
        <h3>Rules for every agent</h3>
        <ul>
          {#each agents.rules as rules (rules.id)}
            <li><a href="/agents/rules?rules={encodeURIComponent(rules.id)}" class="mono">rules/{rules.id}.md</a></li>
          {/each}
        </ul>
        <a class="add" href="/agents/rules">New rules file</a>
      </section>

      {#if agents.configDir}
        <footer>
          <p>
            Agents and rules are files in <span class="mono">{agents.configDir}</span>: one
            <span class="mono">agents/&lt;name&gt;.md</span> per agent, and the rules for every agent. Edit them here or in any
            editor; changes apply from the next message. Agents can't change them.
          </p>
          <p>A vault's own <span class="mono">AGENTS.md</span> is added on top.</p>
        </footer>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pane {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  h2 {
    margin: 0;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .new {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent, #fff);
    font-size: 12px;
    text-decoration: none;
  }
  .rules {
    margin: 4px 12px 0;
    padding: 10px 4px;
    border-top: 1px solid var(--line-soft);
    font-size: 13px;
  }
  .rules h3 {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .rules ul {
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .rules li a {
    display: block;
    padding: 6px 0;
    color: var(--ink);
  }
  .add {
    font-size: 12px;
    color: var(--accent-ink);
  }
  .refresh {
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .body {
    flex: 1 1 auto;
    overflow: auto;
    min-height: 0;
  }
  .agents {
    list-style: none;
    margin: 0;
    padding: 6px;
  }
  .agents button {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .agents button:hover {
    background: var(--sunken);
  }
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .name {
    font-weight: 600;
    color: var(--agent);
  }
  .status {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--ink-3);
  }
  .status[data-status="running"] {
    color: var(--accent-ink);
  }
  .status[data-status="waiting"] {
    color: var(--agent);
    font-weight: 500;
  }
  .description {
    font-size: 13px;
    color: var(--ink-2);
  }
  .autonomy {
    font-size: 12px;
    color: var(--ink-3);
  }
  .problems {
    margin: 10px 12px 0;
    padding: 10px 12px;
    border: 1px solid var(--del);
    border-radius: var(--radius);
    font-size: 12px;
  }
  .problems h3 {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--del);
  }
  .problems ul {
    margin: 0;
    padding-left: 1.1em;
  }
  footer {
    padding: 8px 16px 20px;
    font-size: 12px;
    color: var(--ink-3);
  }
  footer p {
    margin: 0 0 6px;
  }
  footer .mono,
  .problems .mono {
    word-break: break-all;
  }
  .error {
    margin: 8px 16px;
    color: var(--del);
  }
</style>
