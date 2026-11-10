<script lang="ts">
  import { RelatedNotesResponse } from "@wiki-agents/contracts/notes/related-notes/response";
  import { getJson } from "#lib/api/client.ts";
  import { vaultEvents } from "#lib/features/indexing/vault-events.svelte.ts";
  let { vaultId, path }: { vaultId: string; path: string } = $props();
  let notes = $state<typeof RelatedNotesResponse.Type.notes>([]);
  let error = $state(false);
  $effect(() => {
    void vaultEvents.revision;
    const controller = new AbortController();
    notes = []; error = false;
    void getJson(`/api/vaults/${vaultId}/related?path=${encodeURIComponent(path)}`, RelatedNotesResponse, controller.signal).then((response) => { if (!controller.signal.aborted) notes = response.notes; }, () => { if (!controller.signal.aborted) error = true; });
    return () => controller.abort();
  });
</script>
<section><h2>Related notes</h2>
{#if error}<p>Related notes unavailable.</p>{:else if notes.length === 0}<p>No related notes.</p>{:else}<ul>{#each notes as note}<li><a href={`/vaults/${vaultId}?note=${encodeURIComponent(note.path)}`}>{note.title}</a> <small>{note.reasons.join(" · ")}</small></li>{/each}</ul>{/if}
</section>
<style>section { margin-top: 24px; border-top: 1px solid var(--line-soft); font-size: 13px; } h2 { font-size: 14px; } small { color: var(--ink-3); } li { margin: 8px 0; overflow-wrap: anywhere; }</style>
