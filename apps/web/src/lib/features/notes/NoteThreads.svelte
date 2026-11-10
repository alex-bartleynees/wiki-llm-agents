<script lang="ts">
  import { ListNoteContextResponse } from "@wiki-agents/contracts/threads/list-note-context/response";
  import { getJson } from "#lib/api/client.ts";
  import { openThread } from "#lib/features/threads/open-thread.svelte.ts";
  import { threads } from "#lib/features/threads/threads.svelte.ts";
  import { shell } from "#lib/ui/layout/shell.svelte.ts";
  let { vaultId, path }: { vaultId: string; path: string } = $props();
  let links = $state<typeof ListNoteContextResponse.Type.notes>([]);
  let error = $state(false);
  $effect(() => {
    void openThread.version;
    const controller = new AbortController();
    error = false;
    void getJson(`/api/vaults/${vaultId}/thread-notes?path=${encodeURIComponent(path)}`, ListNoteContextResponse, controller.signal).then((response) => { if (!controller.signal.aborted) links = response.notes.filter((note, index, all) => all.findIndex((other) => other.threadId === note.threadId) === index); }, () => { if (!controller.signal.aborted) error = true; });
    return () => controller.abort();
  });
</script>
<section><h2>Threads using this note</h2>
{#if error}<p>Thread links unavailable.</p>{:else if links.length === 0}<p>No threads yet.</p>{/if}
{#each links as link}<button type="button" onclick={() => { threads.select(link.threadId); shell.sidePane = "threads"; shell.tab = "chat"; }}>{link.title ?? "New thread"}</button>{/each}
</section>
<style>section { margin-top: 24px; font-size: 13px; } h2 { font-size: 14px; } button { display: block; background: transparent; border: 0; color: var(--accent-ink); padding: 6px 0; text-align: left; cursor: pointer; }</style>
