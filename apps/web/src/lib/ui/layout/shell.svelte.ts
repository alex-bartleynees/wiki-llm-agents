import type { Tab } from "./BottomBar.svelte";

/** Phone layout state: which pane fills the screen, and whether the vault drawer is open. */
class ShellStore {
  tab = $state<Tab>("wiki");
  drawerOpen = $state(false);

  openDrawer() {
    this.tab = "wiki";
    this.drawerOpen = true;
  }
}

export const shell = new ShellStore();
