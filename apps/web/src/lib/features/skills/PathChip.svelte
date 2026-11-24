<script lang="ts">
  import Button from "#lib/ui/primitives/Button.svelte";
  let { label, path, busy, copy }: {
    label: string;
    path: string;
    busy: boolean;
    copy: (path: string) => void;
  } = $props();
</script>

<div class="path-chip">
  <code class="mono" title={path}>{label}</code>
  <Button variant="link" class="copy" disabled={busy} onclick={() => copy(path)}>Copy</Button>
</div>

<style>
  .path-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    width: fit-content;
    min-width: 0;
    max-width: 100%;
    padding: 3px 9px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--ink-2);
    font-size: 12px;

    code {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    :global(.copy) {
      flex: 0 0 auto;
      min-height: 28px;
    }
  }
</style>
