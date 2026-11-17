<script lang="ts">
  import type { SecretStoreStatus, SecretSummary } from "@wiki-agents/contracts/secrets/model";
  import { untrack } from "svelte";
  import { errorMessage } from "#lib/api/client.ts";
  import { deleteSecret, listSecrets, setSecret } from "./api.ts";
  import { dateFromExpiry, describeExpiry, describeUse, expiryFromDate, isValidName, KEY_SOURCE_LABELS } from "./secret-form.ts";

  /**
   * Secrets MCP servers use as `${secret:<name>}`: stored encrypted on this machine
   * (added and replaced here, never shown), or declared as files in the service's
   * configuration (listed only). The value is kept in this component only while the
   * form is open, never in a draft, and cleared once sent.
   */

  let secrets = $state<ReadonlyArray<SecretSummary>>([]);
  let store = $state<SecretStoreStatus | null>(null);
  let problems = $state<ReadonlyArray<string>>([]);
  let loadError = $state<string | null>(null);
  /** For expiry warnings; set at each load. */
  let now = $state(Date.now());

  /** Open form: null name for a new secret. */
  let editing = $state<{ readonly name: string | null } | null>(null);
  let name = $state("");
  let value = $state("");
  let expiry = $state("");
  let saving = $state(false);
  let errors = $state<ReadonlyArray<string>>([]);
  let notice = $state<string | null>(null);
  /** The secret whose delete is being confirmed. */
  let confirming = $state<string | null>(null);
  let deleteError = $state<string | null>(null);

  async function load() {
    try {
      const listed = await listSecrets();
      secrets = listed.secrets;
      store = listed.store;
      problems = listed.problems;
      loadError = null;
      now = Date.now();
    } catch (cause) {
      loadError = errorMessage(cause, "Could not load the secrets");
    }
  }

  $effect(() => {
    untrack(() => void load());
  });

  function open(secret: SecretSummary | null) {
    editing = { name: secret?.name ?? null };
    name = secret?.name ?? "";
    value = "";
    expiry = dateFromExpiry(secret?.expiresAt ?? null);
    errors = [];
    notice = null;
    confirming = null;
    deleteError = null;
  }

  function close() {
    editing = null;
    value = "";
    errors = [];
  }

  async function save() {
    if (editing === null) return;
    const target = editing.name ?? name.trim();
    const problems: Array<string> = [];
    if (!isValidName(target)) problems.push("Name: lowercase letters, digits and hyphens only, starting with a letter or digit.");
    if (value === "") problems.push("Value: paste the secret's value.");
    if (problems.length > 0) {
      errors = problems;
      return;
    }
    saving = true;
    errors = [];
    try {
      const replacing = editing.name !== null;
      await setSecret(target, { value, expiresAt: expiryFromDate(expiry) });
      close();
      notice = replacing ? `Replaced ${target}.` : `Added ${target}.`;
      await load();
    } catch (cause) {
      errors = errorMessage(cause, "Could not save").split("\n");
    } finally {
      value = "";
      saving = false;
    }
  }

  async function remove(secret: SecretSummary) {
    saving = true;
    deleteError = null;
    try {
      const { stillUsedBy } = await deleteSecret(secret.name, secret.usedBy.length > 0);
      confirming = null;
      notice = stillUsedBy.length === 0 ? `Deleted ${secret.name}.` : `Deleted ${secret.name}; ${stillUsedBy.join(", ")} now ${stillUsedBy.length === 1 ? "has" : "have"} no secret.`;
      await load();
    } catch (cause) {
      deleteError = errorMessage(cause, "Could not delete");
    } finally {
      saving = false;
    }
  }
</script>

<div class="secrets">
  {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}

  {#if store?.state === "unreadable"}
    <p class="error" role="alert">The stored secrets can't be read. {store.problem}</p>
  {:else if store?.keySource}
    <p class="hint">{KEY_SOURCE_LABELS[store.keySource]}</p>
  {/if}

  {#if secrets.length > 0}
    <ul class="list" aria-label="Secrets">
      {#each secrets as secret (secret.name)}
        {@const expires = describeExpiry(secret.expiresAt, now)}
        <li aria-label={secret.name}>
          <div class="row">
            <div class="about">
              <code class="name">{`\${secret:${secret.name}}`}</code>
              <span class="meta">
                {secret.source === "stored" ? "stored" : "declared file"}{#if secret.createdAt !== null}
                  · set {new Date(secret.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}{/if}{#if expires}
                  · <span class:warn={expires.warn}>{expires.text}</span>{/if}
                · {describeUse(secret)}
              </span>
              {#if secret.problem}<span class="problem">{secret.problem}</span>{/if}
            </div>
            {#if secret.source === "stored"}
              <div class="buttons">
                <button type="button" onclick={() => open(secret)} aria-label={`Replace ${secret.name}`} disabled={store?.state === "unreadable"}>Replace</button>
                <button
                  type="button"
                  class="danger"
                  onclick={() => {
                    confirming = secret.name;
                    deleteError = null;
                  }}
                  aria-label={`Delete ${secret.name}`}>Delete</button
                >
              </div>
            {/if}
          </div>
          {#if confirming === secret.name}
            <div class="confirm">
              <span>
                {secret.usedBy.length === 0
                  ? "Forget this secret? It can't be shown or recovered."
                  : `${secret.usedBy.join(", ")} ${secret.usedBy.length === 1 ? "uses" : "use"} it and will have no secret until you add it again or change ${secret.usedBy.length === 1 ? "that server" : "those servers"}.`}
              </span>
              {#if deleteError}<span class="error" role="alert">{deleteError}</span>{/if}
              <div class="buttons">
                <button type="button" class="danger" onclick={() => void remove(secret)} disabled={saving}>
                  {secret.usedBy.length === 0 ? `Forget ${secret.name}` : `Forget ${secret.name} anyway`}
                </button>
                <button type="button" onclick={() => (confirming = null)} disabled={saving}>Keep it</button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else if loadError === null && store !== null}
    <p class="hint">No secrets yet.</p>
  {/if}

  {#if problems.length > 0}
    <ul class="problems" aria-label="Declared secrets that can't be used">
      {#each problems as problem (problem)}<li>{problem}</li>{/each}
    </ul>
  {/if}

  {#if notice}<p class="hint" role="status">{notice}</p>{/if}

  {#if editing === null}
    <div class="actions">
      <button type="button" class="primary" onclick={() => open(null)} disabled={store?.state === "unreadable"}>Add secret</button>
    </div>
  {:else}
    <form
      class="editor"
      aria-label={editing.name === null ? "New secret" : `Replace ${editing.name}`}
      autocomplete="off"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        <span class="label">Name</span>
        {#if editing.name === null}
          <input bind:value={name} aria-label="Secret name" placeholder="github" autocapitalize="off" autocomplete="off" spellcheck="false" />
          <span class="hint">Servers refer to it as <code>{`\${secret:${name.trim() === "" ? "name" : name.trim()}}`}</code>.</span>
        {:else}
          <input value={editing.name} aria-label="Secret name" disabled />
        {/if}
      </label>
      <label>
        <span class="label">Value{editing.name === null ? "" : " (the new one; the old one is never shown)"}</span>
        <input
          type="password"
          bind:value
          aria-label="Secret value"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
        />
      </label>
      <label>
        <span class="label">Expires (optional)</span>
        <input type="date" bind:value={expiry} aria-label="Expires" />
        <span class="hint">When the token stops working, so you can see it coming.</span>
      </label>

      {#if errors.length > 0}
        <ul class="error" role="alert">
          {#each errors as line, index (index)}<li>{line}</li>{/each}
        </ul>
      {/if}

      <div class="actions">
        <button type="submit" class="primary" disabled={saving}>{saving ? "Saving…" : editing.name === null ? "Add" : "Replace"}</button>
        <button type="button" onclick={close} disabled={saving}>Cancel</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .secrets {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 14px;
  }
  .list,
  .problems {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .about {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    color: var(--ink-3);
    font-size: 12px;
  }
  .warn,
  .problem {
    color: var(--del);
  }
  .problem {
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .problems li {
    padding: 8px 12px;
    border: 1px solid var(--del);
    border-radius: var(--radius);
    overflow-wrap: anywhere;
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 12px;
    color: var(--ink-3);
  }
  input {
    box-sizing: border-box;
    width: 100%;
    height: 36px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
  }
  input:disabled {
    color: var(--ink-3);
  }
  .hint {
    margin: 0;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  button {
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .primary {
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .danger {
    border-color: var(--del);
    color: var(--del);
  }
  .error {
    margin: 0;
    padding: 0;
    color: var(--del);
    list-style: none;
  }
  /* Phone: 16px so focusing doesn't zoom. */
  @media (max-width: 899px) {
    input {
      height: 40px;
      font-size: 16px;
    }
    button {
      height: 40px;
    }
  }
</style>
