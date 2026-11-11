import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { isPhone, projectFolder, useReplay } from "./app.ts";

/** git with a fixed identity and none of the user's config. */
const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });

test("reviews a project's diff from git, comments on a line, and sends the review to a thread", async ({ page }, info) => {
  const folder = projectFolder(info, "diff");
  mkdirSync(join(folder, "src"));
  writeFileSync(join(folder, "src", "app.ts"), "const a = 1;\nconst b = 2;\n");
  git(folder, "init", "-q");
  git(folder, "add", "-A");
  git(folder, "commit", "-qm", "init");
  const name = `Diff ${info.project.name}`;
  const response = await page.request.post("/api/projects", { data: { name, workingDirectories: [folder] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };

  // A thread to send the review to.
  await page.goto(`/projects/${project.id}/threads`);
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Hello");
  await message.press("Enter");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  // The agent's work: a changed line and a new file.
  writeFileSync(join(folder, "src", "app.ts"), "const a = 1;\nconst b = 3;\n");
  writeFileSync(join(folder, "notes.md"), "# Notes\n");

  if (isPhone(info)) await page.getByRole("button", { name: "All threads" }).click();
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Diff" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/diff$/);
  const files = page.getByRole("navigation", { name: "Files" });
  await expect(files.getByRole("button")).toHaveCount(2);
  await expect(files.getByRole("button", { name: /src\/app\.ts/ })).toContainText("+1 −1");
  await expect(files.getByRole("button", { name: /notes\.md/ })).toContainText("+1 −0");

  // On a phone the list comes first; a file opens on its own.
  if (isPhone(info)) await files.getByRole("button", { name: /src\/app\.ts/ }).click();
  const diff = page.getByRole("group", { name: "Diff of src/app.ts" });
  await expect(diff).toBeVisible();

  // Search finds the line.
  await page.getByRole("searchbox", { name: "Search the diff" }).fill("b = 3");
  await expect(page.getByText("1 of 1")).toBeVisible();

  await diff.getByRole("button", { name: "added line 2: const b = 3;" }).click();
  await page.getByRole("textbox", { name: "Comment" }).fill("Why 3? Keep it at 2.");
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(diff).toContainText("Why 3? Keep it at 2.");

  if (isPhone(info)) await page.getByRole("button", { name: "‹ All files · 1 comment" }).click();
  const panel = page.getByRole("region", { name: "Review" });
  await expect(panel).toContainText("review · 1 comment");
  await expect(panel).toContainText("src/app.ts:2");
  await expect(panel.getByRole("combobox", { name: "Thread to send the review to" })).toHaveValue(/.+/);
  await expect(panel.getByRole("combobox", { name: "Thread to send the review to" })).not.toHaveValue("new");
  await panel.getByRole("button", { name: "Send to thread" }).click();

  // The thread opens with the review as its new message.
  await expect(page).toHaveURL(/\/projects\/[^/]+\/threads$/);
  const sent = page.locator(".user").last();
  await expect(sent).toContainText("src/app.ts:2");
  await expect(sent).toContainText("Why 3? Keep it at 2.");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  // The drafts went with it.
  if (isPhone(info)) await page.getByRole("button", { name: "All threads" }).click();
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Diff" }).click();
  await expect(page.getByRole("region", { name: "Review" })).toContainText("review · 0 comments");
});

test("ignores a file in the review, keeps it ignored after a reload, and brings it back", async ({ page }, info) => {
  const folder = projectFolder(info, "ignore");
  writeFileSync(join(folder, "app.ts"), "const a = 1;\n");
  writeFileSync(join(folder, "local.config"), "port = 1\n");
  git(folder, "init", "-q");
  git(folder, "add", "-A");
  git(folder, "commit", "-qm", "init");
  writeFileSync(join(folder, "app.ts"), "const a = 2;\n");
  writeFileSync(join(folder, "local.config"), "port = 2\n");
  const response = await page.request.post("/api/projects", { data: { name: `Ignore ${info.project.name}`, workingDirectories: [folder] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };

  await page.goto(`/projects/${project.id}/diff`);
  const files = page.getByRole("navigation", { name: "Files" });
  await expect(files.getByRole("button")).toHaveCount(2);

  // Ignore from the file's header (on a phone, open the file first).
  if (isPhone(info)) await files.getByRole("button", { name: /local\.config/ }).click();
  await page.getByRole("button", { name: "Ignore local.config" }).click();
  await expect(files.getByRole("button", { name: /local\.config/ })).toHaveCount(0);
  const toggle = files.getByRole("button", { name: "▸ Ignored · 1" });
  await expect(toggle).toBeVisible();
  if (!isPhone(info)) {
    await expect(page.getByText("1 file · +1 −1 · 1 ignored")).toBeVisible();
    await expect(page.getByRole("group", { name: "Diff of local.config" })).toHaveCount(0);
  }

  // Kept on the server.
  await page.reload();
  await expect(files.getByRole("button", { name: "▸ Ignored · 1" })).toBeVisible();

  // Shown again for review, and brought back.
  await files.getByRole("button", { name: "▸ Ignored · 1" }).click();
  const ignored = files.getByRole("group", { name: /^Ignored files in / });
  await ignored.getByRole("button", { name: /local\.config/ }).click();
  await expect(page.getByRole("group", { name: "Diff of local.config" })).toBeVisible();
  await page.getByRole("button", { name: "Stop ignoring local.config" }).click();
  if (isPhone(info)) await page.getByRole("button", { name: /^‹ All files/ }).click();
  await expect(files.getByRole("button", { name: /Ignored · / })).toHaveCount(0);
  await expect(files.getByRole("button", { name: /local\.config/ })).toBeVisible();
});
