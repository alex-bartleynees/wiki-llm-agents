/** Desktop sidebar widths, in CSS pixels, remembered on this device. */
const STORAGE_KEY = "wiki-agents:pane-widths";

export interface PaneLimits {
  readonly min: number;
  readonly max: number;
  readonly initial: number;
}

export const VAULT_PANE: PaneLimits = { min: 180, max: 480, initial: 256 };
export const THREADS_PANE: PaneLimits = { min: 260, max: 640, initial: 360 };

const clamp = (value: unknown, limits: PaneLimits) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(limits.max, Math.max(limits.min, value)))
    : limits.initial;

const stored = (): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

class PaneWidthsStore {
  vault = $state(clamp(stored()["vault"], VAULT_PANE));
  threads = $state(clamp(stored()["threads"], THREADS_PANE));

  setVault(width: number) {
    this.vault = clamp(width, VAULT_PANE);
  }

  setThreads(width: number) {
    this.threads = clamp(width, THREADS_PANE);
  }

  /** Called when a drag or key press ends, so storage isn't written on every pointer move. */
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ vault: this.vault, threads: this.threads }));
    } catch {
      // Private mode or full storage: the widths just won't be remembered.
    }
  }
}

export const paneWidths = new PaneWidthsStore();
