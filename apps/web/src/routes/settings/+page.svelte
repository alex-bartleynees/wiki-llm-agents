<script lang="ts">
  import { goto } from "$app/navigation";
  import AppearanceSettings from "#lib/features/appearance/AppearanceSettings.svelte";
  import McpServersSettings from "#lib/features/mcp-servers/McpServersSettings.svelte";
  import CommitMessageSettings from "#lib/features/projects/CommitMessageSettings.svelte";
  import SecretsSettings from "#lib/features/secrets/SecretsSettings.svelte";
  import ProviderList from "#lib/features/threads/ProviderList.svelte";
  import AddVaultForm from "#lib/features/vaults/AddVaultForm.svelte";
  import VaultList from "#lib/features/vaults/VaultList.svelte";
</script>

<svelte:head>
  <title>Settings · wiki-agents</title>
</svelte:head>

<section>
  <h1>Appearance</h1>
  <AppearanceSettings />
  <h1 class="next">Vaults</h1>
  <VaultList />
  <h2>Add a vault</h2>
  <AddVaultForm onadded={(vault) => goto(`/vaults/${vault.id}`)} />
  <h1 class="next">Providers</h1>
  <p class="hint">
    The agents threads run on. OpenCode, Claude Code and Codex are your installed ones, with your own login; checking OpenCode
    starts its server.
  </p>
  <ProviderList />
  <h1 class="next">Commit messages</h1>
  <p class="hint">
    <strong>Suggest message</strong> in a project's Diff view sends the ticked files' diffs and the last ten commit subjects to this
    provider, in one call without tools, and puts the answer in the message box to edit.
  </p>
  <CommitMessageSettings />
  <h1 class="next">MCP servers</h1>
  <p class="hint">
    Servers whose tools the app will offer to agents on every provider, set up once here. A server that asks you to sign in (OAuth)
    can be connected now, and the app keeps its tokens encrypted with the secrets; giving the servers' tools to agents comes with
    the MCP gateway, which isn't built yet.
  </p>
  <McpServersSettings />
  <h1 class="next">Secrets</h1>
  <p class="hint">
    Tokens MCP servers use, written in a server's headers or environment as <code>{"${secret:name}"}</code>. They are kept
    encrypted on this machine and can be replaced but never shown again; enter them once on each machine. Secrets declared in the
    service's configuration (<code>WIKI_AGENTS_SECRET_FILES</code>, e.g. from sops-nix) are listed here and changed there.
  </p>
  <SecretsSettings />
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
