<script lang="ts">
  import type { Component } from "svelte";
  import type { Detail } from "@wiki-agents/contracts/skills/model";
  import TextDiff from "#lib/features/agents/TextDiff.svelte";
  import { showLineDiff } from "./line-diff.ts";

  let { selected, disk, draft = $bindable(), editing, dirty, busy, editor, saveDraft, select }: {
    selected: Detail;
    disk: Detail | null;
    draft: string;
    editing: boolean;
    dirty: boolean;
    busy: boolean;
    editor: Component<{ readOnly: boolean; content: string; change: (text: string) => void; save: () => void }> | undefined;
    saveDraft: (baseHash?: string) => void;
    select: (detail: Detail) => void;
  } = $props();
</script>

<div class="source-column">
  {#if editing && editor}
    {@const SkillEditor = editor}
    <fieldset disabled={busy}>
      <legend>Edit SKILL.md</legend>
      <SkillEditor readOnly={busy} content={draft} change={(text: string) => (draft = text)} save={() => saveDraft()} />
      <div class="buttons">
        <button class="primary" disabled={!dirty || disk !== null} onclick={() => saveDraft()}>Save SKILL.md</button>
        <button onclick={() => select(selected)}>Cancel edit</button>
      </div>
      {#if disk}
        <p>SKILL.md changed on disk. Compare your draft with the disk version.</p>
        {#if showLineDiff(draft, disk.content)}
          <TextDiff before={draft} after={disk.content} label="Draft compared with disk" />
        {:else}
          <pre>{disk.content}</pre>
        {/if}
        <div class="buttons">
          <button onclick={() => disk && select(disk)}>Use disk version</button>
          <button onclick={() => saveDraft(disk?.hash)}>Save my draft over this disk version</button>
        </div>
      {/if}
    </fieldset>
  {:else}
    <div class="preview">
      <div class="preview-header"><code>SKILL.md</code><span>Read only</span></div>
      <pre aria-label="SKILL.md preview">{#each selected.content.split("\n") as line, index}<span class="source-line" class:heading-line={line.startsWith("#")}><span class="line-number" aria-hidden="true">{index + 1}</span><span>{line || " "}</span></span>{/each}</pre>
    </div>
  {/if}
</div>
