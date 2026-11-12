<script lang="ts">
  import Splitter from "#lib/ui/primitives/Splitter.svelte";
  import { type Pane, PANES, paneWidths } from "./pane-widths.svelte.ts";

  /** A splitter for one of the remembered sidebars; set `--{pane}-width` on the layout. */
  let { pane, label, edge }: { pane: Pane; label: string; edge: "start" | "end" } = $props();
</script>

<Splitter
  {label}
  {edge}
  value={paneWidths.widths[pane]}
  {...PANES[pane]}
  onresize={(width) => paneWidths.set(pane, width)}
  oncommit={() => paneWidths.save()}
/>
