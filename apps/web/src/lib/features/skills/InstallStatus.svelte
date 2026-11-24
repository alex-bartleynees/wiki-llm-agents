<script lang="ts">
  let { element = "span", status, text, ariaLabel }: {
    element?: "span" | "output";
    status: string | undefined;
    text: string;
    ariaLabel?: string;
  } = $props();
</script>

<svelte:element this={element} class="install-status" data-status={status} aria-label={ariaLabel}>{text}</svelte:element>

<style>
  .install-status {
    color: var(--ink-3);
    font-size: 12px;
    font-weight: 600;

    &[data-status="installed"],
    &[data-status="external installed"],
    &[data-status="external differs"] {
      color: var(--ok);
    }

    &[data-status="update available"],
    &[data-status="missing"],
    &[data-status="mixed"] {
      color: var(--warn);
    }

    &[data-status="modified"],
    &[data-status="conflict"],
    &[data-status="unmanaged"] {
      color: var(--del);
    }
  }
</style>
