<script lang="ts">
  import { beforeNavigate } from "$app/navigation";
  import type { Heading } from "@wiki-agents/contracts/notes/model";

  /** The open note's headings, in a popover under the button (a bottom sheet on phone). */
  let { headings }: { headings: ReadonlyArray<Heading> } = $props();

  const id = $props.id();
  let button: HTMLButtonElement | undefined = $state();
  let panel: HTMLElement | undefined = $state();
  let position = $state({ top: 0, left: 0 });

  /** Indent relative to the shallowest heading, so a note without an H1 isn't pushed right. */
  const minDepth = $derived(Math.min(...headings.map((heading) => heading.depth)));

  const place = (event: ToggleEvent) => {
    if (event.newState !== "open" || !button) return;
    const rect = button.getBoundingClientRect();
    position = { top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)) };
  };

  // The note view stays mounted when another note opens, so close on the way out.
  beforeNavigate(() => {
    if (panel?.matches(":popover-open")) panel.hidePopover();
  });

  const go = (headingId: string) => {
    panel?.hidePopover();
    // The hash link updates the URL; scrolling here also works when it is already the hash.
    document.getElementById(headingId)?.scrollIntoView({ block: "start" });
  };
</script>

<button bind:this={button} type="button" class="toggle" popovertarget="outline-{id}" aria-label="Outline">
  <span aria-hidden="true">≡</span> Outline
</button>

<nav
  bind:this={panel}
  id="outline-{id}"
  popover="auto"
  aria-label="Outline"
  onbeforetoggle={place}
  style:--top="{position.top}px"
  style:--left="{position.left}px"
>
  <ol>
    {#each headings as heading (heading.id)}
      <li style:--indent={heading.depth - minDepth}>
        <a href="#{heading.id}" onclick={() => go(heading.id)}>{heading.text}</a>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    font: inherit;
    color: var(--ink-3);
    cursor: pointer;
  }
  .toggle:hover {
    color: var(--ink);
  }
  nav {
    position: fixed;
    inset: var(--top) auto auto var(--left);
    width: 320px;
    max-height: min(60vh, 480px);
    margin: 0;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
    overflow: auto;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  a {
    display: block;
    padding: 5px 8px 5px calc(8px + var(--indent) * 14px);
    border-radius: var(--radius);
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--ink-2);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a:hover {
    background: var(--sunken);
    color: var(--ink);
  }
  @media (max-width: 899px) {
    .toggle {
      padding: 4px 10px;
    }
    nav::backdrop {
      background: rgb(0 0 0 / 0.3);
    }
    nav {
      inset: auto 0 0 0;
      width: auto;
      max-height: 60dvh;
      padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
      border-radius: 12px 12px 0 0;
    }
    a {
      padding-top: 10px;
      padding-bottom: 10px;
      font-size: 15px;
    }
  }
</style>
