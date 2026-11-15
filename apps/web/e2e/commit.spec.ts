import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { projectFolder } from "./app.ts";

/** git without the user's config; the repository's own config gives the app's commits an identity. */
const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();

test("commits the ticked files from the diff view, leaves an ignored one out, and pushes", async ({ page }, info) => {
  const root = projectFolder(info, "commit");
  const folder = join(root, "app");
  const remote = join(root, "remote.git");
  mkdirSync(folder, { recursive: true });
  git(folder, "init", "-q", "-b", "main");
  for (const [key, value] of [["user.name", "Test"], ["user.email", "test@example.com"], ["commit.gpgsign", "false"], ["core.hooksPath", join(folder, ".git", "hooks")]]) {
    git(folder, "config", key!, value!);
  }
  writeFileSync(join(folder, "app.ts"), "const a = 1;\n");
  writeFileSync(join(folder, "local.config"), "port = 1\n");
  git(folder, "add", "-A");
  git(folder, "commit", "-qm", "init");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(folder, "remote", "add", "origin", remote);
  git(folder, "push", "-q", "-u", "origin", "main");

  // The agent's work: a change, a new file, and a local setting you never commit.
  writeFileSync(join(folder, "app.ts"), "const a = 2;\n");
  writeFileSync(join(folder, "later.ts"), "export {};\n");
  writeFileSync(join(folder, "local.config"), "port = 2\n");
  const response = await page.request.post("/api/projects", { data: { name: `Commit ${info.project.name}`, workingDirectories: [folder] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };
  await page.request.post(`/api/projects/${project.id}/diff/ignored`, { data: { directory: folder, path: "local.config" } });

  // Suggestions from the replay provider, chosen in Settings (never a real model in tests),
  // from the default each time: the setting is shared by every test on this server.
  expect((await page.request.put("/api/commit-messages/settings", { data: { providerInstanceId: null, model: null } })).status()).toBe(200);
  await page.goto("/settings");
  const settings = page.getByRole("form", { name: "Commit message suggestions" });
  await settings.getByRole("combobox", { name: "Provider for commit messages" }).selectOption({ label: "Replay (recorded, free)" });
  await expect(settings.getByRole("combobox", { name: "Model for commit messages" })).toBeVisible();
  await settings.getByRole("button", { name: "Save commit message settings" }).click();
  await expect(settings.getByRole("status")).toHaveText("Saved.");
  await expect(settings).toContainText("Suggestions now use Replay (recorded, free) (its default model)");

  await page.goto(`/projects/${project.id}/diff`);
  const files = page.getByRole("navigation", { name: "Files" });
  const branch = files.getByRole("group", { name: "Branch main" });
  await expect(branch).toContainText("→ origin/main");
  await expect(branch).toContainText("↑0 ↓0");
  await expect(branch.getByRole("button", { name: "Push" })).toBeDisabled();

  // Ticked by default; the ignored file is unticked under Ignored.
  await expect(files.getByRole("checkbox", { name: "Commit app.ts" })).toBeChecked();
  await expect(files.getByRole("checkbox", { name: "Commit later.ts" })).toBeChecked();
  await files.getByRole("button", { name: "▸ Ignored · 1" }).click();
  await expect(files.getByRole("checkbox", { name: "Commit local.config" })).not.toBeChecked();

  // Leave later.ts for another commit.
  await files.getByRole("checkbox", { name: "Commit later.ts" }).uncheck();
  const box = files.getByRole("form", { name: /^Commit in / });
  await expect(box).toContainText("1 file");
  await expect(box.getByRole("button", { name: "Commit", exact: true })).toBeDisabled();
  const messageBox = box.getByRole("textbox", { name: /^Commit message for / });
  await messageBox.fill("Bump a");

  // Suggest message replaces it with replay's answer for the ticked file; yours can come back.
  await box.getByRole("button", { name: "Suggest message" }).click();
  await expect(messageBox).toHaveValue("Replay suggestion for app.ts\n\nA recorded answer; no model was asked.");
  await expect(box.getByRole("status", { name: "Suggested by" })).toContainText("Suggested by Replay (recorded, free) · ");
  await expect(box.getByRole("status", { name: "Suggested by" })).toContainText("$0.000");
  await box.getByRole("button", { name: "Put back yours" }).click();
  await expect(messageBox).toHaveValue("Bump a");
  await box.getByRole("button", { name: "Commit", exact: true }).click();

  await expect(box.getByRole("status")).toHaveText(/^[0-9a-f]{7,} Bump a$/);
  await expect(box.getByRole("status")).toHaveText(`${git(folder, "rev-parse", "--short", "HEAD")} Bump a`);
  expect(git(folder, "show", "--name-only", "--format=%s", "HEAD").split("\n").filter(Boolean)).toEqual(["Bump a", "app.ts"]);
  // The diff follows git: app.ts is gone, the rest stay.
  await expect(files.getByRole("checkbox", { name: "Commit app.ts" })).toHaveCount(0);
  await expect(files.getByRole("checkbox", { name: "Commit later.ts" })).toBeChecked();
  await expect(branch).toContainText("↑1 ↓0");

  await branch.getByRole("button", { name: "Push" }).click();
  await expect(branch.getByRole("status")).toHaveText("Pushed main to origin/main.");
  await expect(branch).toContainText("↑0 ↓0");
  expect(git(remote, "rev-parse", "main")).toBe(git(folder, "rev-parse", "HEAD"));
});
