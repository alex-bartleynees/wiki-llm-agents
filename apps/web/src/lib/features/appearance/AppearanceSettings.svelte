<script lang="ts">
  import InstalledFontPicker from "./InstalledFontPicker.svelte";
  import { appearance } from "./appearance.svelte.ts";
  import { fontAvailable } from "./font-detect.ts";
  import { cleanFontName, FONT_ROLES, type FontChoice, type FontRole } from "./fonts.ts";
  import { THEMES, type ThemeChoice } from "./themes.ts";

  /** System shows Light and Dark side by side; every other option is its own theme. */
  const options: ReadonlyArray<{ id: ThemeChoice; label: string; previews: ReadonlyArray<string> }> = [
    { id: "system", label: "System", previews: ["light", "dark"] },
    ...THEMES.map((theme) => ({ id: theme.id, label: theme.label, previews: [theme.id] })),
  ];

  const SAMPLES: Record<FontRole, string> = {
    ui: "Search or open a note",
    mono: "const answer = 42; // 0O 1lI",
    read: "Flat whites in the morning, green tea in the afternoon.",
  };

  /** Switching to Custom keeps a name typed earlier in this visit. */
  let names = $state<Record<FontRole, string>>({
    ui: appearance.fonts.ui.kind === "custom" ? appearance.fonts.ui.name : "",
    mono: appearance.fonts.mono.kind === "custom" ? appearance.fonts.mono.name : "",
    read: appearance.fonts.read.kind === "custom" ? appearance.fonts.read.name : "",
  });

  const choose = (role: FontRole, kind: string) => {
    const choice: FontChoice = kind === "custom" ? { kind, name: names[role] } : kind === "system" ? { kind } : { kind: "default" };
    appearance.setFont(role, choice);
  };

  /** A typed name this device can't draw; nothing to say until a name is typed. */
  const missing = (name: string) => cleanFontName(name) !== "" && fontAvailable(cleanFontName(name)) === false;

  const rename = (role: FontRole, name: string) => {
    names[role] = name;
    appearance.setFont(role, { kind: "custom", name });
  };
</script>

<fieldset class="themes">
  <legend>Theme</legend>
  {#each options as option (option.id)}
    <label class="theme" class:chosen={appearance.themeChoice === option.id}>
      <input
        type="radio"
        name="theme"
        value={option.id}
        checked={appearance.themeChoice === option.id}
        onchange={() => appearance.setTheme(option.id)}
      />
      <span class="swatch" aria-hidden="true">
        {#each option.previews as preview (preview)}
          <span class="preview" data-theme-preview={preview}>
            <span class="bar">
              <span class="line"></span>
              <span class="dot accent"></span>
              <span class="dot agent"></span>
            </span>
          </span>
        {/each}
      </span>
      <span class="name">{option.label}</span>
    </label>
  {/each}
</fieldset>
<p class="hint">Remembered on this device. System follows the device's light or dark setting.</p>

<h2>Fonts</h2>
<p class="hint">
  System uses this device's fonts. For Custom, choose an installed font or type its exact family name.
  The sample previews your choice; unavailable fonts fall back to the system font.
</p>
<div class="fonts">
  {#each FONT_ROLES as font (font.role)}
    {@const choice = appearance.fonts[font.role]}
    <div class="font" role="group" aria-label="{font.label} font">
      <label for="font-{font.role}">{font.label}</label>
      <div class="pick">
        <select id="font-{font.role}" value={choice.kind} onchange={(event) => choose(font.role, event.currentTarget.value)}>
          <option value="default">Default ({font.bundled})</option>
          <option value="system">System</option>
          <option value="custom">Custom…</option>
        </select>
        {#if choice.kind === "custom"}
          <input
            type="text"
            aria-label="{font.label} font name"
            placeholder="Family name, e.g. Iosevka"
            autocomplete="off"
            spellcheck="false"
            value={choice.name}
            oninput={(event) => rename(font.role, event.currentTarget.value)}
          />
        {/if}
      </div>
      {#if choice.kind === "custom"}
        <InstalledFontPicker label={font.label} onchoose={(family) => rename(font.role, family)} />
      {/if}
      {#if choice.kind === "custom" && missing(choice.name)}
        <p class="missing" role="status">
          Couldn’t detect “{cleanFontName(choice.name)}”. Check the family name if the sample doesn’t change.
        </p>
      {/if}
      <p class="sample" style:font-family="var({font.token})">{SAMPLES[font.role]}</p>
    </div>
  {/each}
</div>

<style>
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 8px;
    padding: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-2);
  }
  .theme {
    position: relative;
    display: grid;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    cursor: pointer;
  }
  .theme.chosen {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  /* The radio stays focusable and readable to screen readers; the card shows the choice. */
  .theme input {
    position: absolute;
    margin: 0;
    opacity: 0;
  }
  .theme:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .swatch {
    display: flex;
    height: 56px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .preview {
    flex: 1;
    display: flex;
    align-items: flex-end;
    padding: 8px;
    background: var(--bg);
  }
  .bar {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: 3px;
    background: var(--surface);
  }
  .line {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--ink);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.accent {
    background: var(--accent);
  }
  .dot.agent {
    background: var(--agent);
  }
  .name {
    font-size: 13px;
    font-weight: 500;
  }
  h2 {
    margin: 32px 0 8px;
    font-size: 15px;
    font-weight: 600;
  }
  .hint {
    margin: 8px 0 0;
    color: var(--ink-3);
    font-size: 13px;
  }
  .fonts {
    display: grid;
    gap: 18px;
    margin-top: 16px;
  }
  .font {
    display: grid;
    gap: 4px;
  }
  .font > label {
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-2);
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  select,
  input {
    height: 38px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }
  select {
    flex: 0 1 260px;
    min-width: 0;
  }
  input {
    flex: 1 1 220px;
    min-width: 0;
  }
  .sample {
    margin: 4px 0 0;
    color: var(--ink-2);
    font-size: 15px;
  }
  @media (max-width: 899px) {
    select, input { font-size: 16px; }
  }
</style>
