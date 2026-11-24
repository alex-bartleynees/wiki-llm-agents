<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";

  let { size = "small", node = $bindable(), class: className, children, ...rest }: HTMLAttributes<HTMLElement> & {
    size?: "small" | "medium" | "large";
    node?: HTMLElement | undefined;
  } = $props();
</script>

<section {...rest} class={["card", size, className]} bind:this={node}>
  {@render children?.()}
</section>

<style>
  .card {
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .card.medium,
  .card.large {
    padding: 16px;
    border-radius: var(--radius-lg);
  }

  .card.large {
    padding: 24px;
  }

  @media (max-width: 899px) {
    .card.large {
      padding: 16px;
    }
  }
</style>
