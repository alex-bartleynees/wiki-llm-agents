import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { e2eRoot, isPhone, projectFolder, useReplay } from "./app.ts";

test("registers a project through the folder picker, tracks its changed files, and runs its threads", async ({ page }, info) => {
  const folder = projectFolder(info, "app");
  writeFileSync(join(folder, "README.md"), "# App\n");
  const name = `App ${info.project.name}`;

  await page.goto("/projects");
  await page.getByRole("button", { name: "Register project", exact: true }).click();
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

test("registers a vault-only project that works in its notes folder", async ({ page }, info) => {
  const notesFolder = `Plans/Move-${info.project.name}`;
  const notes = join(e2eRoot(), "vault", notesFolder);
  mkdirSync(notes, { recursive: true });
  const name = `Move ${info.project.name}`;

  await page.goto("/projects");
  await page.getByRole("button", { name: "Register project", exact: true }).click();
  const form = page.getByRole("complementary", { name: "Register project" });
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Vault notes only (no repo)").check();
  await expect(form.getByLabel("Directory path")).toBeHidden();
  await form.getByRole("textbox", { name: "Notes folder" }).fill(notesFolder);
  await form.getByRole("button", { name: "Register" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("region", { name: "Working directories" })).toContainText(notes);
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

test("adds a working directory through the folder picker and removes it again", async ({ page }, info) => {
  const main = projectFolder(info, "growing");
  const sibling = projectFolder(info, "sibling");
  writeFileSync(join(sibling, "api.ts"), "export {};\n");
  const response = await page.request.post("/api/projects", { data: { name: `Growing ${info.project.name}`, workingDirectories: [main] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };

  await page.goto(`/projects/${project.id}`);
  const directories = page.getByRole("region", { name: "Working directories" });
  await expect(directories.getByRole("button", { name: `Remove ${main}` })).toHaveCount(0);

  await directories.getByRole("button", { name: "Add directory…" }).click();
  const picker = page.getByRole("dialog", { name: "Add a working directory" });
  await picker.getByLabel("Folder path").fill(join(e2eRoot(), "projects"));
  await picker.getByRole("button", { name: "Go" }).click();
  await picker.getByRole("button", { name: `sibling-${info.project.name}` }).click();
  await picker.getByRole("button", { name: "Choose this folder" }).click();
  await expect(picker).toBeHidden();
  await expect(directories).toContainText(sibling);
  const changes = page.getByRole("region", { name: "Changed files" });
  await expect(changes.getByRole("heading")).toHaveText(/· 0 files$/);
  await expect(changes).toContainText(`sibling-${info.project.name}`);

  await directories.getByRole("button", { name: `Remove ${sibling}` }).click();
  await expect(directories).not.toContainText(sibling);
  await expect(directories).toContainText(main);
  await expect(changes).not.toContainText(`sibling-${info.project.name}`);
  await page.reload();
  await expect(directories).toContainText(main);
  await expect(directories).not.toContainText(sibling);
});

test("adds and removes a working directory from the project sidebar in the threads view", async ({ page }, info) => {
  const main = projectFolder(info, "sidebar");
  const sibling = projectFolder(info, "sidebar-sibling");
  const response = await page.request.post("/api/projects", { data: { name: `Sidebar ${info.project.name}`, workingDirectories: [main] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };

  await page.goto(`/projects/${project.id}/threads`);
  let sidebar = page.getByRole("complementary", { name: "Project", exact: true });
  if (isPhone(info)) {
    const details = page.locator("details.phone-details");
    await details.getByText("Project details").click();
    sidebar = details;
  }
  const directories = sidebar.getByRole("region", { name: "Working directories" });
  await directories.getByRole("button", { name: "Add directory…" }).click();
  const picker = page.getByRole("dialog", { name: "Add a working directory" });
  await picker.getByLabel("Folder path").fill(join(e2eRoot(), "projects"));
  await picker.getByRole("button", { name: "Go" }).click();
  await picker.getByRole("button", { name: `sidebar-sibling-${info.project.name}` }).click();
  await picker.getByRole("button", { name: "Choose this folder" }).click();
  await expect(picker).toBeHidden();
  await expect(directories).toContainText(sibling);
  await expect(sidebar.getByRole("region", { name: "Changed files" })).toContainText(`sidebar-sibling-${info.project.name}`);

  await directories.getByRole("button", { name: `Remove ${sibling}` }).click();
  await expect(directories).not.toContainText(sibling);
  await expect(directories).toContainText(main);
});

test("resizes the project sidebars on desktop and remembers their widths", async ({ page }, info) => {
  const folder = projectFolder(info, "resize");
  const response = await page.request.post("/api/projects", {
    data: { name: `Resize ${info.project.name}`, workingDirectories: [folder] },
  });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };

  await page.goto(`/projects/${project.id}/threads`);
  const threadsSplitter = page.getByRole("separator", { name: "Resize threads sidebar" });
  const detailsSplitter = page.getByRole("separator", { name: "Resize project sidebar" });
  if (isPhone(info)) {
    // One pane at a time on a phone: nothing to resize.
    await expect(threadsSplitter).toBeHidden();
    await expect(detailsSplitter).toBeHidden();
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole("separator", { name: "Resize projects sidebar" })).toBeHidden();
    await expect(page.getByRole("separator", { name: "Resize register project sidebar" })).toBeHidden();
    return;
  }

  const width = async (pane: Locator) => Math.round((await pane.boundingBox())?.width ?? 0);
  const list = page.getByRole("complementary", { name: /^Threads in / });
  const details = page.getByRole("complementary", { name: "Project", exact: true });
  await expect(threadsSplitter).toHaveAttribute("aria-valuenow", "280");
  await expect(detailsSplitter).toHaveAttribute("aria-valuenow", "320");
  expect(await width(list)).toBe(280);
  expect(await width(details)).toBe(320);

  // Shift+arrow moves a splitter 64px; each sidebar grows towards the thread.
  await threadsSplitter.press("Shift+ArrowRight");
  await detailsSplitter.press("Shift+ArrowLeft");
  await expect(threadsSplitter).toHaveAttribute("aria-valuenow", "344");
  await expect(detailsSplitter).toHaveAttribute("aria-valuenow", "384");
  expect(await width(list)).toBe(344);
  expect(await width(details)).toBe(384);

  await page.reload();
  await expect(threadsSplitter).toHaveAttribute("aria-valuenow", "344");
  expect(await width(list)).toBe(344);

  // The diff view's files sidebar too.
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Diff" }).click();
  const filesSplitter = page.getByRole("separator", { name: "Resize files sidebar" });
  await filesSplitter.press("Shift+ArrowRight");
  await expect(filesSplitter).toHaveAttribute("aria-valuenow", "364");
  expect(await width(page.getByRole("complementary", { name: /^Changed files in / }))).toBe(364);

  // And the overview's projects list and register form.
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Register project", exact: true }).click();
  const projectsSplitter = page.getByRole("separator", { name: "Resize projects sidebar" });
  const registerSplitter = page.getByRole("separator", { name: "Resize register project sidebar" });
  await expect(projectsSplitter).toHaveAttribute("aria-valuenow", "240");
  await expect(registerSplitter).toHaveAttribute("aria-valuenow", "340");
  await projectsSplitter.press("Shift+ArrowRight");
  await registerSplitter.press("Shift+ArrowLeft");
  await expect(projectsSplitter).toHaveAttribute("aria-valuenow", "304");
  await expect(registerSplitter).toHaveAttribute("aria-valuenow", "404");
  expect(await width(page.getByRole("complementary", { name: "Projects", exact: true }))).toBe(304);
  expect(await width(page.getByRole("complementary", { name: "Register project" }))).toBe(404);
});

test("collapses registration by default and reopens without losing a draft", async ({ page }, info) => {
  const response = await page.request.post("/api/projects", {
    data: { name: `Sidebar ${info.project.name}`, workingDirectories: [projectFolder(info, "sidebar")] },
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.goto(`/projects/${project.id}`);
  const opener = page.getByRole("button", { name: "Register project", exact: true });
  const form = page.getByRole("complementary", { name: "Register project" });
  const splitter = page.getByRole("separator", { name: "Resize register project sidebar" });
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(form).toBeHidden();
  await expect(splitter).toBeHidden();
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(form.getByLabel("Name")).toBeFocused();
  await form.getByLabel("Name").fill("Unfinished project");
  await form.getByRole("button", { name: "Collapse registration" }).click();
  await expect(form).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(splitter).toBeHidden();
  await opener.click();
  await expect(form.getByLabel("Name")).toHaveValue("Unfinished project");
  if (!isPhone(info)) await expect(splitter).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(form).toBeHidden();
});

test("opens registration by default when there are no projects", async ({ page }) => {
  // The suite shares a server; isolate only this read to exercise an empty catalogue.
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: { projects: [] } });
    else await route.continue();
  });
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "No projects yet" })).toBeVisible();
  const opener = page.getByRole("button", { name: "Register project", exact: true });
  const form = page.getByRole("complementary", { name: "Register project" });
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Collapse registration" }).click();
  await expect(form).toBeHidden();
  await opener.click();
  await expect(form.getByLabel("Name")).toBeFocused();
});
