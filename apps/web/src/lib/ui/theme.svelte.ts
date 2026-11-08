type Theme = "light" | "dark";
/** Also read by the inline script in src/app.html, which sets the theme before first paint. */
const STORAGE_KEY = "wiki-agents:theme";

const initialTheme = (): Theme => {
  // The inline script in app.html has already chosen; start from what is on screen.
  const applied = document.documentElement.dataset["theme"];
  if (applied === "light" || applied === "dark") return applied;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

class ThemeStore {
  current = $state<Theme>(initialTheme());

  constructor() {
    $effect.root(() => {
      $effect(() => {
        document.documentElement.dataset["theme"] = this.current;
      });
    });
  }

  toggle() {
    this.current = this.current === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, this.current);
  }
}

export const theme = new ThemeStore();
