<script lang="ts">
  import { goto } from "$app/navigation";
  import ProviderList from "#lib/features/threads/ProviderList.svelte";
  import AddVaultForm from "#lib/features/vaults/AddVaultForm.svelte";
  import VaultList from "#lib/features/vaults/VaultList.svelte";
</script>

<svelte:head>
  <title>Settings · wiki-agents</title>
</svelte:head>

<section>
  <h1>Vaults</h1>
  <VaultList />
  <h2>Add a vault</h2>
  <AddVaultForm onadded={(vault) => goto(`/vaults/${vault.id}`)} />
  <h1 class="next">Providers</h1>
  <p class="hint">
    The agents threads run on. OpenCode and Claude Code are your installed ones, with your own login; checking OpenCode
    starts its server.
  </p>
  <ProviderList />
</section>

<style>
  section {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px;
  }
  h1 {
    margin: 0 0 16px;
    font: 600 30px/1.2 var(--font-read);
  }
  h1.next {
    margin-top: 48px;
    margin-bottom: 8px;
  }
  h2 {
    margin: 32px 0 12px;
    font-size: 15px;
    font-weight: 600;
  }
  .hint {
    margin: 0 0 12px;
    color: var(--ink-3);
  }
  @media (max-width: 899px) {
    section {
      padding: 24px 18px;
    }
  }
</style>
