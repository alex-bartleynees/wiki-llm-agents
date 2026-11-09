<script lang="ts">
  /**
   * A draggable edge between two panes (an ARIA window splitter). `edge` says which
   * side the resized pane is on: "start" grows when dragged right (a left sidebar),
   * "end" grows when dragged left (a right sidebar). Arrow keys move it by 16px
   * (Shift: 64px); Home and End go to the limits; double-click or Enter resets it.
   */
  let {
    label,
    value,
    min,
    max,
    initial,
    edge,
    onresize,
    oncommit,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    initial: number;
    edge: "start" | "end";
    onresize: (width: number) => void;
    oncommit: () => void;
  } = $props();

  let drag: { readonly pointerId: number; readonly startX: number; readonly startValue: number } | undefined =
    $state(undefined);

  const direction = $derived(edge === "start" ? 1 : -1);

  const pointerdown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, startX: event.clientX, startValue: value };
  };

  const pointermove = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    onresize(drag.startValue + (event.clientX - drag.startX) * direction);
  };

  const pointerup = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = undefined;
    oncommit();
  };

  const keydown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    const moves: Record<string, number | undefined> = {
      ArrowLeft: value - step * direction,
      ArrowRight: value + step * direction,
      Home: min,
      End: max,
      Enter: initial,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onresize(next);
    oncommit();
  };

  const reset = () => {
    onresize(initial);
    oncommit();
  };
</script>

<!-- A focusable separator is interactive by definition (WAI-ARIA window splitter). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter"
  class:dragging={drag !== undefined}
  role="separator"
  aria-label={label}
  aria-orientation="vertical"
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  title="Drag to resize · double-click to reset"
  onpointerdown={pointerdown}
  onpointermove={pointermove}
  onpointerup={pointerup}
  onpointercancel={pointerup}
  onkeydown={keydown}
  ondblclick={reset}
></div>

<svelte:body class:resizing={drag !== undefined} />

<style>
  /* A 9px hit area centred on the pane border, drawn over its neighbours. */
  .splitter {
    flex: 0 0 9px;
    margin: 0 -4px;
    position: relative;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
  }
  .splitter::after {
    content: "";
    position: absolute;
    inset: 0 3px;
    border-radius: 2px;
    background: transparent;
    transition: background-color 120ms ease;
  }
  .splitter:hover::after,
  .splitter.dragging::after,
  .splitter:focus-visible::after {
    background: var(--accent);
  }
  .splitter:focus-visible {
    outline: none;
  }
  /* While dragging: no text selection, and the resize cursor everywhere. */
  :global(body.resizing) {
    cursor: col-resize;
    user-select: none;
  }
  :global(body.resizing iframe) {
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .splitter::after {
      transition: none;
    }
  }
</style>
