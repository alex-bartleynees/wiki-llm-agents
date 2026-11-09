<script lang="ts">
  import { vaultFileHref } from "@wiki-agents/contracts/notes/model";

  let { vaultId, path }: { vaultId: string; path: string } = $props();

  const src = $derived(vaultFileHref(vaultId, path));
  const name = $derived(path.split("/").at(-1) ?? path);
</script>

<svelte:head>
  <title>{name} · wiki-agents</title>
</svelte:head>

<div class="page">
  <p class="bar mono">
    <span class="path">{path}</span>
    <a href={src} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>
  </p>
  <!--
    Untrusted HTML. sandbox="allow-scripts" without allow-same-origin gives the page an
    opaque origin: its scripts can't reach this app's DOM, storage, or API. The server's
    CSP repeats the sandbox and blocks network access. Never add allow-same-origin.
  -->
  <iframe title={name} {src} sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
</div>

<style>
  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    padding: 8px 16px;
    border-bottom: 1px solid var(--line);
    font-size: 11px;
    color: var(--ink-3);
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar a {
    flex: 0 0 auto;
  }
  iframe {
    flex: 1;
    width: 100%;
    border: 0;
    /* Pages bring their own colours; most assume a white background. */
    background: #fff;
  }
</style>
