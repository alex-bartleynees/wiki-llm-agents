<script lang="ts">
  import { Compartment, EditorState, StateEffect } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { untrack } from "svelte";
  import { createEditorState } from "#lib/features/notes/codemirror.ts";

  let { content, change, save, readOnly }: { readOnly: boolean; content: string; change: (text: string) => void; save: () => void } = $props();
  let host: HTMLDivElement;
  let editor = $state.raw<EditorView>();
  const editability = new Compartment();
  const editing = (locked: boolean) => [EditorState.readOnly.of(locked), EditorView.editable.of(!locked)];
  $effect(() => {
    const view = new EditorView({
      parent: host,
      state: createEditorState(untrack(() => content), { onChange: change, onSave: save, merge: new Compartment() }),
    });
    view.dispatch({ effects: StateEffect.appendConfig.of(editability.of(editing(untrack(() => readOnly)))) });
    editor = view;
    return () => view.destroy();
  });
  $effect(() => { editor?.dispatch({ effects: editability.reconfigure(editing(readOnly)) }); });
</script>

<div class="source" bind:this={host}></div>

<style>
  .source { border: 1px solid var(--line); border-radius: var(--radius); min-width: 0; overflow: auto; max-height: 55vh; font-size: 16px; }
  .source :global(.cm-content) { padding: 8px; }
</style>
