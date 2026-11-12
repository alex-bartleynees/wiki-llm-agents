/** Desktop sidebar widths, in CSS pixels, remembered on this device. */
const STORAGE_KEY = "wiki-agents:pane-widths";

export interface PaneLimits {
  readonly min: number;
  readonly max: number;
  readonly initial: number;
}

/** Every resizable sidebar: the wiki's two, and the project views'. */
export const PANES = {
  vault: { min: 180, max: 480, initial: 256 },
  threads: { min: 260, max: 640, initial: 360 },
  projectList: { min: 180, max: 400, initial: 240 },
  registerProject: { min: 280, max: 560, initial: 340 },
  projectThreads: { min: 220, max: 480, initial: 280 },
  projectDetails: { min: 260, max: 560, initial: 320 },
  diffFiles: { min: 220, max: 560, initial: 300 },
} as const satisfies Record<string, PaneLimits>;

export type Pane = keyof typeof PANES;

export const VAULT_PANE: PaneLimits = PANES.vault;
export const THREADS_PANE: PaneLimits = PANES.threads;

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

const initialWidths = (): Record<Pane, number> => {
  const saved = stored();
  return Object.fromEntries(
    Object.entries(PANES).map(([pane, limits]) => [pane, clamp(saved[pane], limits)]),
  ) as Record<Pane, number>;
};

class PaneWidthsStore {
  widths = $state(initialWidths());

  get vault() {
    return this.widths.vault;
  }

  get threads() {
    return this.widths.threads;
  }

  set(pane: Pane, width: number) {
    this.widths[pane] = clamp(width, PANES[pane]);
  }

  setVault(width: number) {
    this.set("vault", width);
  }

  setThreads(width: number) {
    this.set("threads", width);
  }

  /** Called when a drag or key press ends, so storage isn't written on every pointer move. */
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.widths));
    } catch {
      // Private mode or full storage: the widths just won't be remembered.
    }
  }
}

export const paneWidths = new PaneWidthsStore();
