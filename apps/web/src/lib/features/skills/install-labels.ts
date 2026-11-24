import type { InstallTarget } from "@wiki-agents/contracts/skills/model";

export const installLabels = {
  installed: "Up to date",
  "update available": "Update available",
  "external installed": "Installed",
  "external differs": "Installed",
  unmanaged: "Unmanaged conflict",
  conflict: "Conflict",
  modified: "Locally modified",
  missing: "Missing install",
  absent: "Not installed",
} satisfies Record<InstallTarget["status"], string>;
