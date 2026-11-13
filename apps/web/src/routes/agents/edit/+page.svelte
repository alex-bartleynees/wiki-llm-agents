<script lang="ts">
  import { page } from "$app/state";
  import AgentEditor from "#lib/features/agents/AgentEditor.svelte";
  import { editorExit } from "#lib/features/agents/leave.ts";

  /** `?agent=<id>` edits that agent; without it, a new one. */
  const agentId = $derived(page.url.searchParams.get("agent"));
  const leave = editorExit();
</script>

{#key agentId}
  <AgentEditor {agentId} onclose={leave} />
{/key}
