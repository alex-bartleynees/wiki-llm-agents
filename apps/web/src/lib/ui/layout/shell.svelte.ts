import { MediaQuery } from "svelte/reactivity";
import type { Tab } from "./BottomBar.svelte";

export type Sidebar = "files" | "search";

/**
 * Layout state. Phone: which pane fills the screen, and whether the vault drawer is
 * open. Desktop: whether the vault sidebar shows files or search. Both: the quick
 * switcher dialog.
 */
class ShellStore {
  tab = $state<Tab>("wiki");
  drawerOpen = $state(false);
  sidebar = $state<Sidebar>("files");
  switcherOpen = $state(false);
  /** Same breakpoint as the layout's CSS. */
  readonly phone = new MediaQuery("max-width: 899px");

  openDrawer() {
    this.tab = "wiki";
    this.drawerOpen = true;
  }

  /** Shows the search screen: the Search tab on phone, the sidebar's search on desktop. */
  showSearch() {
    if (this.phone.current) {
      this.tab = "search";
      this.drawerOpen = false;
    } else {
      this.sidebar = "search";
    }
  }
}

export const shell = new ShellStore();

/** `⌘K` on Apple devices, `Ctrl K` elsewhere. */
export const shortcutLabel = (key: string) =>
  /Mac|iPhone|iPad/.test(navigator.userAgent) ? `⌘${key}` : `Ctrl ${key}`;
