<script lang="ts">
  import { goto } from "$app/navigation";
  import AddVaultForm from "#lib/features/vaults/AddVaultForm.svelte";
  import { vaults } from "#lib/features/vaults/vaults.svelte.ts";

  // With a vault registered, open the last one used; otherwise offer to add one.
  $effect(() => {
    void vaults.load().then(() => {
      const vault = vaults.preferred;
      if (vault) void goto(`/vaults/${vault.id}`, { replaceState: true });
    });
  });
</script>

<section>
  {#if vaults.state.status === "failed"}
    <h1>Can't reach the server</h1>
    <p class="muted">{vaults.state.message}</p>
  {:else if vaults.state.status === "loaded" && vaults.list.length === 0}
    <h1>Add your first vault</h1>
    <p class="muted">A vault is a folder of markdown notes, such as an Obsidian vault.</p>
    <AddVaultForm onadded={(vault) => goto(`/vaults/${vault.id}`)} />
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</section>

<style>
  section {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px;
  }
  h1 {
    margin: 0 0 8px;
    font: 600 30px/1.2 var(--font-read);
  }
  .muted {
    margin: 0 0 20px;
    color: var(--ink-3);
  }
  @media (max-width: 899px) {
    section {
      padding: 24px 18px;
    }
  }
</style>
