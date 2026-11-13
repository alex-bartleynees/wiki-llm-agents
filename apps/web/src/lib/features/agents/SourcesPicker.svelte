<script lang="ts">
  import type { KnowledgeSource, VaultSource } from "@wiki-agents/contracts/agents/model";
  import type { Vault } from "@wiki-agents/contracts/vaults/model";

  /**
   * An agent's knowledge sources. "No limits" is an empty list; otherwise the
   * thread's vault, named vaults (whole, or some folders), and the web.
   */
  let { sources = $bindable(), vaults }: { sources: ReadonlyArray<KnowledgeSource>; vaults: ReadonlyArray<Vault> } = $props();

  let limited = $state(sources.length > 0);
  // The text typed per vault, so commas and half-typed names survive until saved.
  let folderText = $state<Record<string, string>>({});

  const named = $derived(sources.filter((source): source is VaultSource => typeof source !== "string"));
  /** Vaults the sources name that aren't registered here (the config is synced between machines). */
  const elsewhere = $derived(named.filter((source) => !vaults.some((vault) => vault.name === source.vault)));
  const has = (word: "vault" | "web") => sources.includes(word);
  const entry = (name: string) => named.find((source) => source.vault === name);

  const toggleWord = (word: "vault" | "web", on: boolean) => {
    sources = on ? [...sources.filter((source) => source !== word), word] : sources.filter((source) => source !== word);
  };
  const toggleVault = (name: string, on: boolean) => {
    const rest = sources.filter((source) => typeof source === "string" || source.vault !== name);
    sources = on ? [...rest, { vault: name, folders: parseFolders(folderText[name] ?? "") }] : rest;
  };
  const parseFolders = (text: string) =>
    text
      .split(",")
      .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ""))
      .filter((folder) => folder !== "");
  const setFolders = (name: string, text: string) => {
    folderText[name] = text;
    sources = sources.map((source) => (typeof source !== "string" && source.vault === name ? { vault: name, folders: parseFolders(text) } : source));
  };
  const folderValue = (name: string) => folderText[name] ?? entry(name)?.folders.join(", ") ?? "";

  const setLimited = (on: boolean) => {
    limited = on;
    if (!on) sources = [];
    else if (sources.length === 0) sources = ["vault", "web"];
  };
</script>

<fieldset class="sources">
  <legend>Knowledge sources</legend>
  <label class="choice"><input type="radio" name="limited" checked={!limited} onchange={() => setLimited(false)} /> No limits: any vault the thread works in, and the web</label>
  <label class="choice"><input type="radio" name="limited" checked={limited} onchange={() => setLimited(true)} /> Only these:</label>

  {#if limited}
    <ul class="list">
      <li>
        <label class="choice"><input type="checkbox" checked={has("vault")} onchange={(event) => toggleWord("vault", event.currentTarget.checked)} /> The vault the thread works in</label>
      </li>
      {#each vaults as vault (vault.id)}
        {@const chosen = entry(vault.name) !== undefined}
        <li>
          <label class="choice">
            <input type="checkbox" checked={chosen} onchange={(event) => toggleVault(vault.name, event.currentTarget.checked)} />
            <span>{vault.name}</span>
          </label>
          {#if chosen}
            <label class="folders">
              <span>Folders in {vault.name}</span>
              <input
                value={folderValue(vault.name)}
                oninput={(event) => setFolders(vault.name, event.currentTarget.value)}
                placeholder="All of it, or folders: Projects, Areas/Home"
                spellcheck="false"
                autocapitalize="off"
              />
            </label>
          {/if}
        </li>
      {/each}
      {#each elsewhere as source (source.vault)}
        <li>
          <label class="choice">
            <input type="checkbox" checked onchange={() => toggleVault(source.vault, false)} />
            <span>{source.vault}{source.folders.length > 0 ? `: ${source.folders.join(", ")}` : ""} <em>(not registered on this machine)</em></span>
          </label>
        </li>
      {/each}
      <li>
        <label class="choice"><input type="checkbox" checked={has("web")} onchange={(event) => toggleWord("web", event.currentTarget.checked)} /> The web (as its autonomy allows)</label>
      </li>
    </ul>
    {#if sources.length === 0}
      <p class="warn" role="status">Nothing ticked: saved like this, the agent has no limits.</p>
    {:else}
      <p class="hint">The vault tools reach only these; without the web, the agent can't use it.</p>
    {/if}
  {/if}
</fieldset>

<style>
  .sources {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 4px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .choice {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 14px;
    color: var(--ink);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 2px 0 0;
    padding: 0 0 0 24px;
    list-style: none;
  }
  .folders {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 4px 0 0 24px;
    font-size: 12px;
    color: var(--ink-3);
  }
  input:not([type="radio"], [type="checkbox"]) {
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }
  em {
    color: var(--ink-3);
    font-style: normal;
    font-size: 12px;
  }
  .hint,
  .warn {
    margin: 0;
    font-size: 12px;
    color: var(--ink-3);
  }
  .warn {
    color: var(--warn);
  }
  @media (max-width: 899px) {
    input:not([type="radio"], [type="checkbox"]) {
      font-size: 16px;
    }
  }
</style>
