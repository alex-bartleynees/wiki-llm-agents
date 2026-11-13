import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { e2eRoot, isPhone, openVault, tab } from "./app.ts";

const config = () => join(e2eRoot(), "config");

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

/** The agents list: a tab on a phone, the right pane's Agents view on desktop. */
const agentsPane = async (page: Page, info: TestInfo) => {
  await openVault(page);
  if (isPhone(info)) await tab(page, info, "Agents");
  else await page.getByRole("tablist", { name: "Right pane" }).getByRole("tab", { name: "Agents" }).click();
  return page.getByRole(isPhone(info) ? "region" : "complementary", { name: isPhone(info) ? "Agents" : "Agent threads" });
};

test("creates an agent in the app, then edits it over a change made on disk", async ({ page }, info) => {
  const width = info.project.name;
  const pane = await agentsPane(page, info);
  await pane.getByRole("link", { name: "New agent" }).click();
  await expect(page).toHaveURL(/\/agents\/edit$/);

  const form = page.getByRole("form", { name: "New agent" });
  await form.getByLabel("Name", { exact: true }).fill(`Scout ${width}`);
  await expect(form.getByLabel("File name", { exact: true })).toHaveValue(`scout-${width}`);
  await form.getByLabel("Description", { exact: true }).fill("Looks around the projects.");
  await form.getByRole("radiogroup", { name: "Edit existing files" }).getByLabel("Never").check();
  await form.getByLabel("Only these:").check();
  // Only these starts from the thread's vault and the web; leave the web out.
  await form.getByLabel("The web (as its autonomy allows)").uncheck();
  await form.getByLabel("vault", { exact: true }).check();
  await form.getByLabel("Folders in vault").fill("Projects");
  await form.getByLabel("Instructions").fill("# Scout\n\nLook around before answering.");
  await noOverflow(page);
  await form.getByRole("button", { name: "Create agent" }).click();

  await expect(page).toHaveURL(new RegExp(`/agents/edit\\?agent=scout-${width}$`));
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  const file = join(config(), "agents", `scout-${width}.md`);
  const written = readFileSync(file, "utf8");
  expect(written).toContain(`name: Scout ${width}\n`);
  expect(written).toContain("  edit: deny\n");
  expect(written).toContain("sources:\n  - vault\n  - vault: vault\n    folders:\n      - Projects\n");
  expect(written).toMatch(/---\n\n# Scout\n\nLook around before answering\.\n$/);

  // Someone changes the file on another machine (Syncthing) while it is open here.
  const editForm = page.getByRole("form", { name: "Edit agent" });
  await editForm.getByLabel("Description", { exact: true }).fill("Looks around carefully.");
  writeFileSync(file, written.replace("Look around before answering.", "Look around, then answer."));
  await editForm.getByRole("button", { name: "Save" }).click();

  const conflict = page.getByRole("region", { name: "Changed on disk" });
  await expect(conflict).toContainText("The file changed on disk since you opened it");
  await expect(conflict).toContainText("On disk: Looks around the projects.");
  await expect(conflict).toContainText("Yours: Looks around carefully.");
  await expect(conflict.getByLabel("Instructions: on disk, then yours")).toContainText("Look around, then answer.");
  await noOverflow(page);
  await conflict.getByRole("button", { name: "Save mine over it" }).click();
  await expect(conflict).toBeHidden();
  expect(readFileSync(file, "utf8")).toContain("description: Looks around carefully.\n");

  // Back in the list, the agent is there with its sources and autonomy.
  await page.getByRole("button", { name: "Back" }).click();
  const list = await agentsPane(page, info);
  await list.getByRole("button", { name: new RegExp(`Scout ${width}`) }).click();
  await expect(list).toContainText("vault: Projects");
  await expect(list).toContainText("The thread's vault");
  await list.getByRole("link", { name: "Edit" }).click();

  // Deleting moves the file to the config folder's trash.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).not.toHaveURL(/\/agents\/edit/);
  expect(existsSync(file)).toBe(false);
  expect(existsSync(join(config(), ".trash", "agents", `scout-${width}.md`))).toBe(true);
});

test("refuses an agent the app couldn't load, saying which field is wrong", async ({ page }, info) => {
  await page.goto("/agents/edit");
  const form = page.getByRole("form", { name: "New agent" });
  await form.getByLabel("Name", { exact: true }).fill(`Empty ${info.project.name}`);
  await form.getByRole("button", { name: "Create agent" }).click();
  await expect(form).toContainText("Write what the agent should do.");
  expect(existsSync(join(config(), "agents", `empty-${info.project.name}.md`))).toBe(false);
  // Opened directly, Back goes to the app's start.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/vaults\/[^/]+$/);
});

test("creates and edits a rules file, taking the disk's version in a conflict", async ({ page }, info) => {
  const width = info.project.name;
  const pane = await agentsPane(page, info);
  await pane.getByRole("link", { name: "New rules file" }).click();

  const form = page.getByRole("form", { name: "New rules" });
  await form.getByLabel("File name", { exact: true }).fill(`style-${width}`);
  await form.getByLabel("Rules for every agent").fill("# Style\n\n- Plain words.");
  await noOverflow(page);
  await form.getByRole("button", { name: "Create rules" }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/rules\\?rules=style-${width}$`));
  const file = join(config(), "rules", `style-${width}.md`);
  expect(readFileSync(file, "utf8")).toBe("# Style\n\n- Plain words.");

  const edit = page.getByRole("form", { name: "Edit rules" });
  await edit.getByLabel("Rules for every agent").fill("# Style\n\n- Plain words.\n- Short sentences.");
  writeFileSync(file, "# Style\n\n- Plain words.\n- British spelling.");
  await edit.getByRole("button", { name: "Save" }).click();
  const conflict = page.getByRole("region", { name: "Changed on disk" });
  await expect(conflict.getByLabel("On disk, then yours")).toContainText("British spelling.");
  await conflict.getByRole("button", { name: "Use the disk version" }).click();
  await expect(edit.getByLabel("Rules for every agent")).toHaveValue("# Style\n\n- Plain words.\n- British spelling.");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await edit.getByRole("button", { name: "Delete" }).click();
  await expect(page).not.toHaveURL(/\/agents\/rules/);
  expect(existsSync(file)).toBe(false);
  const list = await agentsPane(page, info);
  await expect(list.getByRole("link", { name: "rules/wiki-llm.md" })).toBeVisible();
  await expect(list.getByRole("link", { name: `rules/style-${width}.md` })).toHaveCount(0);
});
