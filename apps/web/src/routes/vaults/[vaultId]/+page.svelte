<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { VIEW_PARAMS } from "@wiki-agents/contracts/notes/model";
  import JsonView from "#lib/features/notes/JsonView.svelte";
  import NoteView from "#lib/features/notes/NoteView.svelte";
  import { EDIT_PARAM } from "#lib/features/notes/edit-param.ts";
  import PageView from "#lib/features/notes/PageView.svelte";
  import VaultHome from "#lib/features/notes/VaultHome.svelte";
  import { recent } from "#lib/features/notes/recent.svelte.ts";
  import { showThread, THREAD_PARAM } from "#lib/features/threads/thread-link.ts";

  // Notes are `?note=<path>`: note names often contain dots, which a path segment
  // would turn into a "file extension" for the static server's SPA fallback.
  const vaultId = $derived(page.params["vaultId"] ?? "");
  const note = $derived(page.url.searchParams.get(VIEW_PARAMS.note));
  const htmlPage = $derived(page.url.searchParams.get(VIEW_PARAMS.page));
  const json = $derived(page.url.searchParams.get(VIEW_PARAMS.json));

  // Opening a file is an event, so it is recorded on navigation (also the first load).
  // Notes add themselves once their title is known; pages and JSON go in by name.
  afterNavigate(({ to }) => {
    const vault = to?.params?.["vaultId"];
    if (to === null || vault === undefined) return;
    // A link to a thread (from the inbox) opens it beside the vault.
    const threadId = to.url.searchParams.get(THREAD_PARAM);
    if (threadId !== null) void showThread(threadId).catch(() => undefined);
    const pagePath = to.url.searchParams.get(VIEW_PARAMS.page);
    const path = pagePath ?? to.url.searchParams.get(VIEW_PARAMS.json);
    if (path === null) return;
    recent.add(vault, { path, kind: pagePath !== null ? "page" : "json", title: path.split("/").at(-1) ?? path });
  });
</script>

{#if note}
  {#key vaultId}
    <NoteView {vaultId} path={note} editing={page.url.searchParams.has(EDIT_PARAM)} />
  {/key}
{:else if htmlPage}
  <PageView {vaultId} path={htmlPage} />
{:else if json}
  <JsonView {vaultId} path={json} />
{:else}
  <VaultHome {vaultId} />
{/if}
