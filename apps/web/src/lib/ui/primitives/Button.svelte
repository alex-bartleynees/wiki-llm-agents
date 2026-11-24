<script lang="ts">
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

  type Look = {
    variant?: "secondary" | "primary" | "link";
    size?: "small" | "medium" | "large";
    danger?: boolean;
    pill?: boolean;
  };
  type Props = Look & ((HTMLButtonAttributes & { href?: undefined }) | (HTMLAnchorAttributes & { href: string }));

  let { variant = "secondary", size = "medium", danger = false, pill = false, class: className, children, ...rest }: Props = $props();

  const element = $derived(rest.href === undefined ? "button" : "a");
  const type = $derived(rest.href === undefined ? "button" : undefined);
</script>

<svelte:element this={element} {type} {...rest} class={["button", variant, size, danger && "danger", pill && "pill", className]}>
  {@render children?.()}
</svelte:element>

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    padding: 4px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-family: var(--font-ui);
    font-size: 13px;
    text-decoration: none;
    cursor: pointer;
  }

  .button:hover:not(:disabled) {
    background: var(--sunken);
  }

  .button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .button.small {
    min-height: 28px;
    padding: 2px 10px;
    font-size: 12px;
  }

  .button.large {
    min-height: 40px;
    border-radius: var(--radius-md);
    font-size: 14px;
  }

  .button.pill {
    border-radius: 999px;
  }

  .button[aria-pressed="true"] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .button.danger {
    border-color: var(--del);
    color: var(--del);
  }

  .button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .button.primary.danger {
    border-color: var(--del);
    background: var(--del);
  }

  .button.primary:hover:not(:disabled) {
    background: var(--accent);
    box-shadow: inset 0 0 0 2px var(--on-accent);
  }

  .button.primary.danger:hover:not(:disabled) {
    background: var(--del);
  }

  .button.link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-ink);
    font-size: inherit;
    text-align: start;
  }

  .button.link:hover:not(:disabled) {
    background: transparent;
    text-decoration: underline;
  }

  .button.link:not(.large) {
    min-height: 0;
  }

  .button.link.danger {
    color: var(--del);
  }

  @media (max-width: 899px) {
    .button.small {
      min-height: 36px;
    }

    .button.medium:not(.link) {
      min-height: 40px;
    }

    .button.large {
      min-height: 44px;
    }
  }
</style>
