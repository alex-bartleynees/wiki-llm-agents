<script lang="ts">
  import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
  import { errorMessage } from "#lib/api/client.ts";
  import { agents } from "./agents.svelte.ts";
  import { setThreadAgent } from "./api.ts";

  let { thread, onchange }: { thread: ThreadSummary; onchange: (thread: ThreadSummary) => void } = $props();

  let busy = $state(false);
  let error = $state<string | undefined>(undefined);

  $effect(() => {
    void agents.load();
  });

  const choose = async (value: string) => {
    busy = true;
    try {
      onchange((await setThreadAgent(thread.id, value === "" ? null : value)).thread);
      error = undefined;
    } catch (failure) {
      error = errorMessage(failure, "Couldn't switch the agent");
    } finally {
      busy = false;
    }
  };

  /** The thread's agent, even if its file has since gone or broken (so the select still shows it). */
  const missing = $derived(thread.agentId !== null && agents.list.length > 0 && agents.get(thread.agentId) === undefined);
</script>

<select
  class="mono"
  aria-label="Agent"
  title={error ?? "Agent, from the next message"}
  class:error={error !== undefined || missing}
  disabled={busy}
  value={thread.agentId ?? ""}
  onchange={(event) => void choose(event.currentTarget.value)}
>
  <option value="">No agent</option>
  {#each agents.list as agent (agent.id)}
    <option value={agent.id}>{agent.name}</option>
  {/each}
  {#if missing && thread.agentId !== null}
    <option value={thread.agentId} disabled>{thread.agentId} (missing)</option>
  {/if}
</select>

<style>
  select {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 50%;
    height: 28px;
    padding: 0 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--agent);
    font-size: 11px;
  }
  select.error {
    border-color: var(--del);
  }
</style>
