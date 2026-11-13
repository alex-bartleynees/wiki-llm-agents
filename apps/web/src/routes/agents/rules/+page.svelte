<script lang="ts">
  import { page } from "$app/state";
  import { editorExit } from "#lib/features/agents/leave.ts";
  import RulesEditor from "#lib/features/agents/RulesEditor.svelte";

  /** `?rules=<id>` edits that rules file; without it, a new one. */
  const rulesId = $derived(page.url.searchParams.get("rules"));
  const leave = editorExit();
</script>

{#key rulesId}
  <RulesEditor {rulesId} onclose={leave} />
{/key}
