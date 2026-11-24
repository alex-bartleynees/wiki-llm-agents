<script lang="ts">
  import type { McpServerSummary } from "@wiki-agents/contracts/mcp-servers/model";
  import type { Project } from "@wiki-agents/contracts/projects/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { listMcpServers } from "#lib/features/mcp-servers/api.ts";
  import { getProjectMcpServers, saveProjectMcpServers } from "./api.ts";
  import Button from "#lib/ui/primitives/Button.svelte";

  /**
   * The MCP servers every thread in the project gets, whatever its agent: ticked from
   * Settings › MCP servers. Servers for every thread are shown ticked and fixed; one the
   * project lists that's no longer in Settings is shown so it can be unticked.
   */
  let { project }: { project: Project } = $props();

  let servers = $state<ReadonlyArray<McpServerSummary>>([]);
  let chosen = $state<Array<string>>([]);
  let savedJson = $state("[]");
  let loaded = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);

  const changed = $derived(JSON.stringify(chosen) !== savedJson);
  const choosable = $derived(servers.filter((server) => !server.default));
  const everyThread = $derived(servers.filter((server) => server.default));
  const exists = (id: string) => servers.some((server) => server.id === id);
  /** Listed but not in Settings, as saved or ticked: kept on screen once unticked, until saved. */
  const missing = $derived([...new Set([...(JSON.parse(savedJson) as Array<string>), ...chosen])].filter((id) => !exists(id)));
  /** Ticked servers that exist: what the project adds for its threads. */
  const count = $derived(chosen.filter(exists).length);

  $effect(() => {
    const projectId = project.id;
    const controller = new AbortController();
    loaded = false;
    error = null;
    Promise.all([getProjectMcpServers(projectId, controller.signal), listMcpServers(controller.signal)])
      .then(([response, list]) => {
        show(response.serverIds);
        servers = list.servers;
        loaded = true;
      })
      .catch((cause) => {
        if (!controller.signal.aborted) error = errorMessage(cause, "Could not load the project's MCP servers");
      });
    return () => controller.abort();
  });

  function show(serverIds: ReadonlyArray<string>) {
    chosen = [...serverIds];
    savedJson = JSON.stringify(serverIds);
  }

  function toggle(id: string, on: boolean) {
    chosen = on ? [...chosen, id] : chosen.filter((other) => other !== id);
    saved = false;
  }

  async function save() {
    saving = true;
    saved = false;
    error = null;
    try {
      show((await saveProjectMcpServers(project.id, { serverIds: chosen })).serverIds);
      saved = true;
    } catch (cause) {
      error = errorMessage(cause, "Could not save the project's MCP servers");
    } finally {
      saving = false;
    }
  }
</script>

<section id="mcp-servers" class="servers" aria-label="MCP servers">
  <h2 class="mono">mcp servers · {count}</h2>
  <p class="note">
    Every thread in this project gets the tools of the servers ticked here, whatever its agent, besides those its agent lists.
    Add servers in <a href="/settings">Settings › MCP servers</a>. Each tool still follows the agent's autonomy. Threads use changes
    from their next message.
  </p>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if loaded}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {#if servers.length === 0 && missing.length === 0}
        <p class="note">No MCP servers yet.</p>
      {:else}
        <ul class="list">
          {#each choosable as server (server.id)}
            <li>
              <label class="check">
                <input type="checkbox" checked={chosen.includes(server.id)} onchange={(event) => toggle(server.id, event.currentTarget.checked)} />
                <span class="title">{server.title}</span>
                <code>{server.id}</code>
              </label>
            </li>
          {/each}
          {#each everyThread as server (server.id)}
            <li>
              <label class="check fixed">
                <input type="checkbox" checked disabled />
                <span class="title">{server.title}</span>
                <code>{server.id}</code>
                <span class="meta">every thread</span>
              </label>
            </li>
          {/each}
          {#each missing as id (id)}
            <li>
              <label class="check">
                <input type="checkbox" checked={chosen.includes(id)} onchange={(event) => toggle(id, event.currentTarget.checked)} />
                <code>{id}</code>
                <span class="meta missing">not in Settings</span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="actions">
        <Button type="submit" variant="primary" disabled={!changed || saving}>{saving ? "Saving…" : "Save MCP servers"}</Button>
        {#if saved && !changed}<span class="hint" role="status">Saved.</span>{/if}
      </div>
    </form>
  {/if}
</section>

<style>
  .servers {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-3);
  }
  .note {
    margin: 0;
    font-size: 13px;
    color: var(--ink-3);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .list li + li {
    border-top: 1px solid var(--line);
  }
  .check {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 4px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .fixed {
    cursor: default;
    color: var(--ink-2);
  }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .meta {
    margin-left: auto;
    font-size: 12px;
    color: var(--ink-3);
  }
  .missing {
    color: var(--del);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .hint {
    font-size: 13px;
    color: var(--ink-3);
  }
  .error {
    margin: 0;
    color: var(--del);
    white-space: pre-line;
  }
  a {
    color: var(--accent-ink);
  }
  /* Phone: taller rows to tap. */
  @media (max-width: 899px) {
    .check {
      min-height: 44px;
    }
  }
</style>
