import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

export const isPhone = (info: TestInfo) => info.project.use.isMobile === true;

/** The run's temporary folder (see playwright.config.ts). */
export const e2eRoot = () => {
  const root = process.env["E2E_ROOT"];
  if (root === undefined) throw new Error("E2E_ROOT is set by playwright.config.ts");
  return root;
};

/** A new empty folder for this test's project, under the run's projects folder. */
export const projectFolder = (info: TestInfo, name: string) => {
  const path = join(e2eRoot(), "projects", `${name}-${info.project.name}`);
  mkdirSync(path, { recursive: true });
  return path;
};

/** Opens the vault ("/" goes to it), waiting for its home page. */
export const openVault = async (page: Page) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/vaults\/[^/]+$/);
};

/** On a phone, switches to a bottom-bar tab; desktop shows every pane at once. */
export const tab = async (page: Page, info: TestInfo, name: "Wiki" | "Chat" | "Agents" | "Search") => {
  if (isPhone(info)) await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name }).click();
};

/** New threads use the replay provider: no agent is installed for these tests, and test hooks add it. */
export const useReplay = async (page: Page) => {
  await page.getByLabel("Provider for new threads").selectOption({ label: "Replay (recorded, free)" });
};

/** The text each syntax colour covers on the page (`syntax-keyword` → ["const", ...]), from the CSS Custom Highlight API. */
export const syntaxColours = (page: Page) =>
  page.evaluate(() => {
    const colours: Record<string, Array<string>> = {};
    for (const [name, highlight] of CSS.highlights) {
      colours[name] = Array.from(highlight as unknown as Set<AbstractRange>, (range) => {
        const live = document.createRange();
        live.setStart(range.startContainer, range.startOffset);
        live.setEnd(range.endContainer, range.endOffset);
        return live.toString();
      });
    }
    return colours;
  });
