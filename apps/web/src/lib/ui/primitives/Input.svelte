<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  let { value = $bindable(""), size = "medium", mono = false, class: className, ...rest }: Omit<HTMLInputAttributes, "size" | "value"> & {
    value?: string;
    size?: "medium" | "large";
    mono?: boolean;
  } = $props();
</script>

<input {...rest} class={["input", size, mono && "monospace", className]} bind:value />

<style>
  .input {
    width: 100%;
    min-width: 0;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
  }

  .input.large {
    height: 40px;
    padding-inline: 12px;
    border-radius: var(--radius-md);
  }

  .input.monospace {
    font-family: var(--font-mono);
  }

  .input::placeholder,
  .input:disabled {
    color: var(--ink-3);
  }

  @media (max-width: 899px) {
    .input {
      height: 40px;
      font-size: 16px;
    }

    .input.large {
      height: 44px;
    }
  }
</style>
