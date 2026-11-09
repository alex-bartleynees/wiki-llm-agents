<script lang="ts">
  import type { Backlink } from "@wiki-agents/contracts/notes/get-backlinks/response";
  import { noteHref } from "@wiki-agents/contracts/notes/model";

  let { vaultId, backlinks }: { vaultId: string; backlinks: ReadonlyArray<Backlink> | undefined } = $props();
</script>

<section aria-labelledby="backlinks-heading">
  <h2 id="backlinks-heading" class="mono">
    Linked from {backlinks === undefined ? "…" : backlinks.length === 1 ? "1 note" : `${backlinks.length} notes`}
  </h2>
  {#if backlinks !== undefined && backlinks.length > 0}
    <ul>
      {#each backlinks as link (link.path)}
        {@const folder = link.path.split("/").slice(0, -1).join("/")}
        <li>
          <a href={noteHref(vaultId, link.path)}>
            <span class="title">{link.title}</span>
            {#if folder}<span class="folder mono">{folder}</span>{/if}
          </a>
        </li>
      {/each}
    </ul>
  {:else if backlinks !== undefined}
    <p>No notes link here yet.</p>
  {/if}
</section>

<style>
  section {
    margin-top: 48px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  h2 {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  a {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    padding: 6px 8px;
    margin: 0 -8px;
    border-radius: var(--radius);
    text-decoration: none;
  }
  a:hover {
    background: var(--sunken);
  }
  .title {
    color: var(--accent-ink);
    font-weight: 500;
  }
  .folder {
    font-size: 11px;
    color: var(--ink-3);
  }
  p {
    margin: 0;
    font-size: 13px;
    color: var(--ink-3);
  }
  @media (max-width: 899px) {
    a {
      min-height: 40px;
    }
  }
</style>
