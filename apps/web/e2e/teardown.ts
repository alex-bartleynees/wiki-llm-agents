import { rmSync } from "node:fs";

/** Removes the run's temporary vault, data and config. */
export default function teardown() {
  const root = process.env["E2E_ROOT"];
  if (root !== undefined && root.includes("wiki-agents-e2e-")) rmSync(root, { recursive: true, force: true });
}
