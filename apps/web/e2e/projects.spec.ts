import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { e2eRoot, isPhone, projectFolder, useReplay } from "./app.ts";

test("registers a project through the folder picker, tracks its changed files, and runs its threads", async ({ page }, info) => {
  const folder = projectFolder(info, "app");
  writeFileSync(join(folder, "README.md"), "# App\n");
  const name = `App ${info.project.name}`;

  await page.goto("/projects");
  const form = page.getByRole("complementary", { name: "Register project" });
  await form.getByLabel("Name").fill(name);

  // Walk to the folder: type its parent, go, then click into it.
  await form.getByRole("button", { name: "Browse…" }).first().click();
  const picker = page.getByRole("dialog", { name: "Choose the main directory" });
  await picker.getByLabel("Folder path").fill(join(e2eRoot(), "projects"));
  await picker.getByRole("button", { name: "Go" }).click();
  await picker.getByRole("button", { name: `app-${info.project.name}` }).click();
  await picker.getByRole("button", { name: "Choose this folder" }).click();
  await expect(picker).toBeHidden();
  await expect(form.getByLabel("Directory path")).toHaveValue(folder);

  await form.getByRole("button", { name: "Register" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("region", { name: "Working directories" })).toContainText(folder);

  // Changed files: none at registration; a new file shows after a rescan, until reviewed.
  const changes = page.getByRole("region", { name: "Changed files" });
  await expect(changes.getByRole("heading")).toHaveText(/· 0 files$/);
  writeFileSync(join(folder, "new.ts"), "export {};\n");
  await changes.getByRole("button", { name: "Rescan" }).click();
  await expect(changes.getByRole("heading")).toHaveText(/· 1 file$/);
  await expect(changes).toContainText("new.ts");
  await changes.getByRole("button", { name: "Mark all reviewed" }).click();
  await expect(changes.getByRole("heading")).toHaveText(/· 0 files$/);

  // Threads view: the project's threads, with the open one in the middle.
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Threads" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/threads$/);
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Hello project");
  await message.press("Enter");
  await expect(page.locator(".user").last()).toHaveText("Hello project");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  // On a phone the thread replaces the list; back shows the list again.
  if (isPhone(info)) {
    await page.getByRole("button", { name: "All threads" }).click();
    await expect(page.getByRole("button", { name: "New thread", exact: true })).toBeVisible();
  }

  // Only this project's thread is listed, in both views.
  await expect(page.getByRole("complementary", { name: `Threads in ${name}` }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Overview" }).click();
  const overviewThreads = page.getByRole("region", { name: "Threads" });
  await expect(overviewThreads.getByRole("heading")).toHaveText("threads in this project · 1 open · 0 done");
  await expect(overviewThreads.getByRole("list", { name: "Open project threads" })).toContainText("Hello project");

  // A done thread moves into the collapsed "done" group.
  await overviewThreads.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText("✓ done")).toBeVisible();
  if (isPhone(info)) await page.getByRole("button", { name: "All threads" }).click();
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Overview" }).click();
  await expect(overviewThreads.getByRole("heading")).toHaveText("threads in this project · 0 open · 1 done");
  await expect(overviewThreads).toContainText("Every thread here is done.");
  const doneThreads = overviewThreads.getByRole("list", { name: "Done project threads" });
  await expect(doneThreads).toBeHidden();
  await overviewThreads.getByText("done · 1").click();
  await expect(doneThreads).toContainText("Hello project");
});

test("archives a project out of the way and restores it", async ({ page }, info) => {
  const folder = projectFolder(info, "old");
  const name = `Old ${info.project.name}`;
  const response = await page.request.post("/api/projects", { data: { name, workingDirectories: [folder] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };

  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("archived project")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Archived");
  await expect(page.getByRole("button", { name: "New thread here" })).toBeHidden();
  const list = page.getByRole("complementary", { name: "Projects" });
  await expect(list.locator("details.archived").getByRole("link", { name })).toBeVisible();

  // The threads view no longer offers it to switch to, except as the open one.
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Threads" }).click();
  const switcher = page.getByRole("combobox", { name: "project", exact: true });
  await expect(switcher.locator("option", { hasText: `${name} (archived)` })).toHaveCount(1);
  await expect(switcher.locator("option", { hasText: new RegExp(`^${name}$`) })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Overview" }).click();

  await page.getByRole("button", { name: "Restore project" }).click();
  await expect(page.getByRole("button", { name: "New thread here" })).toBeVisible();
  await expect(list.locator("details.archived").getByRole("link", { name })).toHaveCount(0);
});
