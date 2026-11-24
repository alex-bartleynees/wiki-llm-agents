<script lang="ts">
  let { label, path, busy, copy }: {
    label: string;
    path: string;
    busy: boolean;
    copy: (path: string) => void;
  } = $props();
</script>

<div class="path-chip">
  <code title={path}>{label}</code>
  <button class="text-button" type="button" disabled={busy} onclick={() => copy(path)}>Copy</button>
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
    border-radius: var(--skill-control-radius);
    background: var(--bg);
    color: var(--ink-2);
    font-size: 12px;

    code {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .text-button {
      flex: 0 0 auto;
      min-height: 28px;
      font-size: 12px;
    }
  }
</style>
