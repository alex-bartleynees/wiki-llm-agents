<script lang="ts">
  import { tick } from "svelte";
  import { recent } from "#lib/features/notes/recent.svelte.ts";
  import { noteName } from "#lib/features/threads/mentions.ts";
  import { quickSwitch } from "./api.ts";

  /**
   * Picks one note of a vault, as the thread composer's `@` does: recent notes while
   * the box is empty, notes matching the title or path once you type (quick switcher).
   * The picked note shows as a chip; `path` is null when none is picked.
   */
  let {
    vaultId,
    path = $bindable(null),
    query = $bindable(""),
    label,
  }: { vaultId: string; path?: string | null; query?: string; label: string } = $props();

  /** Notes offered at once. */
  const MAX_SUGGESTIONS = 8;

  interface Suggestion {
    readonly path: string;
    readonly name: string;
  }

  let open = $state(false);
  let suggestions = $state<ReadonlyArray<Suggestion>>([]);
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  const id = $props.id();

  $effect(() => {
    const vault = vaultId;
    const text = query.trim();
    if (!open || path !== null) {
      suggestions = [];
      return;
    }
    const offer = (notes: ReadonlyArray<Suggestion>) => {
      suggestions = notes.slice(0, MAX_SUGGESTIONS);
      active = 0;
    };
    if (text === "") {
      offer(recent.list(vault).filter((file) => file.kind === "note").map((file) => ({ path: file.path, name: file.title })));
      return;
    }
    const controller = new AbortController();
    quickSwitch(vault, text, controller.signal).then(
      (response) => offer(response.results.filter((result) => result.kind === "note").map((result) => ({ path: result.path, name: result.title }))),
      () => {
        if (!controller.signal.aborted) suggestions = [];
      },
    );
    return () => controller.abort();
  });

  const pick = (note: Suggestion) => {
    path = note.path;
    query = "";
    open = false;
  };

  const clear = async () => {
    path = null;
    open = true;
    await tick();
    input?.focus();
  };

  function onkeydown(event: KeyboardEvent) {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
    } else if (event.key === "Enter" && !event.isComposing) {
      // Choosing a note must not submit the form around the picker.
      event.preventDefault();
      const note = suggestions[active];
      if (note !== undefined) pick(note);
    } else if (event.key === "Escape") {
      event.preventDefault();
      open = false;
    }
  }

  const showing = $derived(open && path === null && suggestions.length > 0);
</script>

<div class="note-picker">
  <span class="label" id="{id}-label">{label}</span>
  {#if path !== null}
    <span class="chip" title={path}>
      @{noteName(path)}
      <button type="button" aria-label="Remove {noteName(path)}" onclick={clear}>×</button>
    </span>
  {:else}
    <div class="field">
      <input
        bind:this={input}
        bind:value={query}
        role="combobox"
        aria-labelledby="{id}-label"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={showing ? `${id}-list` : undefined}
        aria-activedescendant={showing ? `${id}-option-${active}` : undefined}
        placeholder="Search notes"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        onfocus={() => (open = true)}
        oninput={() => (open = true)}
        onblur={() => (open = false)}
        {onkeydown}
      />
      {#if showing}
        <ul class="suggestions" id="{id}-list" role="listbox" aria-label="Notes">
          {#each suggestions as note, index (note.path)}
            <!-- The search box keeps focus and handles the keyboard; options only need the pointer. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
              id="{id}-option-{index}"
              role="option"
              aria-selected={index === active}
              onpointerdown={(event) => event.preventDefault()}
              onclick={() => pick(note)}
              onpointerenter={() => (active = index)}
            >
              <span class="name">{note.name}</span>
              <span class="path">{note.path}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .note-picker {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .field {
    position: relative;
    align-self: stretch;
  }
  input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    padding: 2px 2px 2px 6px;
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-family: var(--font-mono);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .chip button {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .suggestions {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 3;
    max-height: 280px;
    overflow: auto;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
  }
  [role="option"] {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  [role="option"][aria-selected="true"] {
    background: var(--accent-soft);
  }
  .name {
    font-size: 14px;
    color: var(--ink);
  }
  .path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
  @media (max-width: 899px) {
    /* 16px stops iOS from zooming into the field. */
    input {
      font-size: 16px;
    }
    [role="option"] {
      min-height: 44px;
      justify-content: center;
    }
  }
</style>
