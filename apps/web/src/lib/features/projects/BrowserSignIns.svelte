<script lang="ts">
  import { type BrowserSignIn, browserSignInProblems, type Project } from "@wiki-agents/contracts/projects/model";
  import type { SecretSummary } from "@wiki-agents/contracts/secrets/model";
  import { tick } from "svelte";
  import { page } from "$app/state";
  import { errorMessage } from "#lib/api/client.ts";
  import { listSecrets } from "#lib/features/secrets/api.ts";
  import { getBrowserSignIns, saveBrowserSignIns } from "./api.ts";
  import { blankSignIn, type SignInForm, signInFromForm, signInToForm } from "./sign-in-form.ts";
  import Button from "#lib/ui/primitives/Button.svelte";

  /**
   * The project's browser sign-ins: test accounts the built-in browser signs in to local
   * apps with. Opened from a thread's "needs a sign-in" card with `?add-sign-in=<site>&origin=<origin>`,
   * it starts a new one for that site.
   */
  let { project }: { project: Project } = $props();

  let forms = $state<Array<SignInForm>>([]);
  let savedJson = $state("[]");
  let secrets = $state<ReadonlyArray<SecretSummary>>([]);
  let loaded = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let error = $state<string | null>(null);
  let section = $state<HTMLElement>();

  const signIns = $derived(forms.map(signInFromForm));
  const changed = $derived(JSON.stringify(signIns) !== savedJson);
  const problems = $derived(browserSignInProblems(signIns));

  $effect(() => {
    const projectId = project.id;
    const controller = new AbortController();
    loaded = false;
    error = null;
    Promise.all([getBrowserSignIns(projectId, controller.signal), listSecrets(controller.signal).catch(() => null)])
      .then(async ([response, secretList]) => {
        show(response.signIns);
        secrets = secretList?.secrets ?? [];
        loaded = true;
        await startFromCard();
      })
      .catch((cause) => {
        if (!controller.signal.aborted) error = errorMessage(cause, "Could not load the browser sign-ins");
      });
    return () => controller.abort();
  });

  function show(list: ReadonlyArray<BrowserSignIn>) {
    forms = list.map(signInToForm);
    savedJson = JSON.stringify(list);
  }

  /** From a thread's card: a new sign-in for the site, unless one already covers it. */
  async function startFromCard() {
    const site = page.url.searchParams.get("add-sign-in");
    const origin = page.url.searchParams.get("origin") ?? "";
    if (site === null || forms.some((form) => form.origins.split("\n").map((line) => line.trim()).includes(origin))) return;
    forms.push(blankSignIn(site, origin));
    await tick();
    section?.scrollIntoView({ block: "start" });
    section?.querySelector<HTMLInputElement>(`[data-sign-in="${forms.length - 1}"] input`)?.focus();
  }

  async function add() {
    forms.push(blankSignIn("", ""));
    saved = false;
    await tick();
    section?.querySelector<HTMLInputElement>(`[data-sign-in="${forms.length - 1}"] input`)?.focus();
  }

  async function save() {
    if (problems.length > 0) return;
    saving = true;
    saved = false;
    error = null;
    try {
      show((await saveBrowserSignIns(project.id, { signIns })).signIns);
      saved = true;
    } catch (cause) {
      error = errorMessage(cause, "Could not save the browser sign-ins");
    } finally {
      saving = false;
    }
  }

  const secretMissing = (name: string) => name !== "" && !secrets.some((secret) => secret.name === name);
</script>

<section id="browser-sign-ins" class="sign-ins" aria-label="Browser sign-ins" bind:this={section}>
  <h2 class="mono">browser sign-ins · {forms.length}</h2>
  <p class="note">
    Test accounts the built-in browser signs in to local apps with. Agents are told the names and type them; the browser
    types the secret instead, only on the sites listed, and asks you first every time. Store the values in
    <a href="/settings">Settings › Secrets</a>; never type a password in a thread. Threads use changes from their next message.
  </p>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if loaded}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {#each forms as form, index (form.key)}
        <fieldset class="sign-in" data-sign-in={index}>
          <legend class="mono">{form.name.trim() || "new sign-in"}</legend>
          <label>
            <span class="label">Name</span>
            <input bind:value={form.name} oninput={() => (saved = false)} placeholder="My app (local)" aria-label="Sign-in name" autocomplete="off" />
          </label>
          <label>
            <span class="label">Sites, one per line</span>
            <textarea
              bind:value={form.origins}
              oninput={() => (saved = false)}
              rows="2"
              placeholder="http://localhost:3000"
              aria-label="Sites for {form.name.trim() || 'this sign-in'}"
              autocapitalize="off"
              spellcheck="false"
            ></textarea>
          </label>
          <div class="credentials" role="group" aria-label="Credentials">
            <span class="label">Credentials: the name the agent types, and the secret the browser types</span>
            {#each form.credentials as credential, row (credential.key)}
              <div class="credential">
                <input
                  class="mono"
                  bind:value={credential.variable}
                  oninput={() => (saved = false)}
                  placeholder="APP_PASSWORD"
                  aria-label="Name the agent types"
                  autocapitalize="characters"
                  autocomplete="off"
                  spellcheck="false"
                />
                <select bind:value={credential.secret} onchange={() => (saved = false)} aria-label="Secret for {credential.variable || 'this credential'}">
                  <option value="">Choose a secret…</option>
                  {#if secretMissing(credential.secret)}<option value={credential.secret}>{credential.secret} (not stored)</option>{/if}
                  {#each secrets as secret (secret.name)}<option value={secret.name}>{secret.name}</option>{/each}
                </select>
                <Button
                  variant="link"
                  aria-label="Remove {credential.variable || 'credential'}"
                  onclick={() => {
                    form.credentials.splice(row, 1);
                    saved = false;
                  }}>Remove</Button
                >
              </div>
            {/each}
            <Button
              variant="link"
              class="start"
              onclick={() => {
                form.credentials.push({ key: crypto.randomUUID(), variable: "", secret: "" });
                saved = false;
              }}>Add credential</Button
            >
          </div>
          <Button
            variant="link"
            danger
            class="start"
            onclick={() => {
              forms.splice(index, 1);
              saved = false;
            }}>Remove sign-in</Button
          >
        </fieldset>
      {/each}

      {#if secrets.length === 0}
        <p class="note">No secrets are stored yet. Add the account's username and password in <a href="/settings">Settings › Secrets</a> first.</p>
      {/if}
      {#if changed && problems.length > 0}
        <ul class="problems" aria-label="To fix before saving">
          {#each problems as problem (problem)}<li>{problem}</li>{/each}
        </ul>
      {/if}
      <div class="actions">
        <Button onclick={add}>Add sign-in</Button>
        <Button type="submit" variant="primary" disabled={!changed || problems.length > 0 || saving}>{saving ? "Saving…" : "Save sign-ins"}</Button>
        {#if saved && !changed}<span class="hint" role="status">Saved.</span>{/if}
      </div>
    </form>
  {/if}
</section>

<style>
  .sign-ins {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-3);
  }
  .note {
    margin: 0;
    font-size: 13px;
    color: var(--ink-3);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sign-in {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  legend {
    padding: 0 4px;
    font-size: 12px;
    color: var(--ink-2);
  }
  label,
  .credentials {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 12px;
    color: var(--ink-3);
  }
  .credential {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
  }
  input,
  select,
  textarea {
    box-sizing: border-box;
    min-width: 0;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
  }
  input,
  select {
    height: 34px;
  }
  textarea {
    padding: 6px 8px;
    resize: vertical;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .sign-in :global(.start) {
    align-self: flex-start;
  }
  .problems {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    color: var(--del);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .hint {
    font-size: 13px;
    color: var(--ink-3);
  }
  .error {
    margin: 0;
    color: var(--del);
    white-space: pre-line;
  }
  a {
    color: var(--accent-ink);
  }
  /* Phone: one field per line, and 16px so focusing doesn't zoom. */
  @media (max-width: 899px) {
    .credential {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .credential select {
      grid-column: 1;
    }
    input,
    select,
    textarea {
      font-size: 16px;
    }
    input,
    select {
      height: 40px;
    }
  }
</style>
