<script lang="ts">
  import { page } from "$app/state";
  import { VIEW_PARAMS } from "@wiki-agents/contracts/notes/model";
  import JsonView from "#lib/features/notes/JsonView.svelte";
  import NoteView from "#lib/features/notes/NoteView.svelte";
  import PageView from "#lib/features/notes/PageView.svelte";
  import VaultHome from "#lib/features/notes/VaultHome.svelte";

  // Notes are `?note=<path>`: note names often contain dots, which a path segment
  // would turn into a "file extension" for the static server's SPA fallback.
  const vaultId = $derived(page.params["vaultId"] ?? "");
  const note = $derived(page.url.searchParams.get(VIEW_PARAMS.note));
  const htmlPage = $derived(page.url.searchParams.get(VIEW_PARAMS.page));
  const json = $derived(page.url.searchParams.get(VIEW_PARAMS.json));
</script>

{#if note}
  {#key vaultId}
    <NoteView {vaultId} path={note} />
  {/key}
{:else if htmlPage}
  <PageView {vaultId} path={htmlPage} />
{:else if json}
  <JsonView {vaultId} path={json} />
{:else}
  <VaultHome {vaultId} />
{/if}
