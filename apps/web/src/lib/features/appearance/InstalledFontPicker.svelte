<script lang="ts">
  import { quoted } from "./fonts.ts";
  import { canListLocalFonts, listLocalFontFamilies } from "./local-fonts.ts";

  let { label, onchoose }: { label: string; onchoose: (family: string) => void } = $props();
  const supported = canListLocalFonts();
  let families = $state<string[] | null>(null);
  let filter = $state("");
  let busy = $state(false);
  let message = $state("");
  const filtered = $derived(families?.filter((family) => family.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? []);

  const discover = async () => {
    busy = true;
    message = "";
    try {
      families = await listLocalFontFamilies();
      if (families.length === 0) message = "No fonts were shared by this browser. You can still type a family name.";
    } catch (error) {
      message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Font access wasn't allowed. Try again or type a family name."
        : "Couldn't list fonts in this browser. Try again or type a family name.";
    } finally {
      busy = false;
    }
  };
</script>

{#if supported}
  <button type="button" onclick={discover} disabled={busy} aria-expanded={families !== null}>
    {busy ? "Finding fonts…" : "Choose installed font…"}
  </button>
  <p class="hint">Your browser may ask permission to list fonts on this device.</p>
  {#if families !== null && families.length > 0}
    <div class="picker">
      <input type="search" aria-label="Filter {label} fonts" placeholder="Filter installed fonts" bind:value={filter} autocomplete="off" autocapitalize="off" spellcheck="false" />
      <select aria-label="Installed {label} font" size="6" onchange={(event) => onchoose(event.currentTarget.value)}>
        {#each filtered as family (family)}
          <option value={family} style:font-family={quoted(family)}>{family}</option>
        {/each}
      </select>
      {#if filtered.length === 0}<p class="hint">No matching fonts.</p>{/if}
    </div>
  {/if}
{:else}
  <p class="hint">This browser can't list installed fonts. You can type a family name instead.</p>
{/if}
{#if message}<p class="hint" role="status">{message}</p>{/if}

<style>
  button, input, select {
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    min-width: 0;
    max-width: 100%;
  }
  button { justify-self: start; cursor: pointer; }
  button:disabled { cursor: default; opacity: 0.6; }
  .picker { display: grid; gap: 6px; min-width: 0; }
  select { width: 100%; }
  option { padding: 4px; }
  .hint { margin: 0; font-size: 13px; color: var(--ink-3); }
  @media (max-width: 899px) {
    input, select { font-size: 16px; }
  }
</style>
