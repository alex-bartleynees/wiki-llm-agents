import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { isPhone, projectFolder, useReplay } from "./app.ts";

/** git with a fixed identity and none of the user's config. */
const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });

const NOTE = "# Replay note\n";

for (const entry of ["overview", "threads"] as const) {
test(`from ${entry}: runs a thread in its own worktree, reviews its diff, and removes the worktree when done`, async ({ page }, info) => {
  const folder = projectFolder(info, `worktree-${entry}`);
  writeFileSync(join(folder, "Replay note.md"), NOTE);
  git(folder, "init", "-q");
  git(folder, "add", "-A");
  git(folder, "commit", "-qm", "init");
  const response = await page.request.post("/api/projects", { data: { name: `Worktree ${info.project.name}`, workingDirectories: [folder] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string; vaultId: string } };
  const branch = `wiki-agents/e2e-${entry}-${info.project.name}`;

  // New thread, in a worktree on a branch of our choosing (a fresh name is suggested).
  await page.goto(`/projects/${project.id}${entry === "threads" ? "/threads" : ""}`);
  await useReplay(page);
  await page.getByRole("checkbox", { name: "Worktree" }).check();
  const branchField = page.getByRole("textbox", { name: "Branch for the new thread's worktree" });
  await expect(branchField).toHaveValue(/^wiki-agents\/[0-9a-f]{8}$/);
  await branchField.fill(branch);
  await page.getByRole("button", { name: entry === "threads" ? "New thread" : "New thread here", exact: true }).click();
  const bar = page.getByRole("region", { name: "Worktree" });
  await expect(bar).toContainText(`⎇ ${branch}`);
  // The option resets for the next thread (the list is beside the thread on desktop).
  if (!isPhone(info)) await expect(page.getByRole("checkbox", { name: "Worktree" })).not.toBeChecked();

  // The replay agent's edit lands in the worktree, not the main directory.
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Please edit the note");
  await message.press("Enter");
  await page.getByRole("region", { name: "Approval" }).getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);
  const listed = (await (await page.request.get(`/api/projects/${project.id}/worktrees`)).json()) as { worktrees: Array<{ directory: string }> };
  const worktree = listed.worktrees[0]!.directory;
  await expect(bar).toContainText(worktree);
  expect(readFileSync(join(worktree, "Replay note.md"), "utf8")).toContain("A line added by the replay agent.");
  expect(readFileSync(join(folder, "Replay note.md"), "utf8")).toBe(NOTE);

  // The Diff view shows the worktree on its own, labelled with its branch.
  if (isPhone(info)) await page.getByRole("button", { name: "All threads" }).click();
  await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Diff" }).click();
  const files = page.getByRole("navigation", { name: "Files" });
  await expect(files).toContainText(`⎇ ${branch}`);
  await expect(files.getByRole("button", { name: /Replay note\.md/ })).toHaveCount(1);
  await expect(files.getByRole("button", { name: /Replay note\.md/ })).toContainText("+1 −0");

  // A comment on the worktree goes to its thread by default (not the newer plain thread),
  // with the path as that thread sees it.
  const plain = await page.request.post(`/api/vaults/${project.vaultId}/threads`, { data: { projectId: project.id } });
  expect(plain.status()).toBe(201);
  if (isPhone(info)) await files.getByRole("button", { name: /Replay note\.md/ }).click();
  const diff = page.getByRole("group", { name: "Diff of Replay note.md" });
  await diff.getByRole("button", { name: "added line 2: - A line added by the replay agent." }).click();
  await page.getByRole("textbox", { name: "Comment" }).fill("Say why.");
  // A refresh that brings back the same diff (a turn ending elsewhere, say) keeps the comment open.
  const refreshed = page.waitForResponse((reply) => reply.url().endsWith(`/api/projects/${project.id}/diff`));
  await page.getByRole("button", { name: "Refresh" }).click();
  await refreshed;
  await expect(page.getByRole("textbox", { name: "Comment" })).toHaveValue("Say why.");
  await page.getByRole("button", { name: "Add comment" }).click();
  if (isPhone(info)) await page.getByRole("button", { name: "‹ All files · 1 comment" }).click();
  const panel = page.getByRole("region", { name: "Review" });
  await expect(panel).toContainText(`⎇ ${branch}: Replay note.md:2`);
  await expect(panel.getByRole("combobox", { name: "Thread to send the review to" }).locator("option:checked")).toHaveText(
    `Please edit the note · ⎇ ${branch}`,
  );
  await panel.getByRole("button", { name: "Send to thread" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/threads$/);
  const sent = page.locator(".user").last();
  await expect(sent).toContainText("## Replay note.md");
  await expect(sent).not.toContainText(worktree);
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  // The overview lists it with its changed files.
  await page.goto(`/projects/${project.id}`);
  const overview = page.getByRole("region", { name: "Worktrees" });
  await expect(overview).toContainText(`⎇ ${branch}`);
  await expect(overview).toContainText("1 file changed");

  // Mark done offers to remove it; git refuses while the change is uncommitted.
  await overview.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/threads$/);
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(bar).toContainText("This thread is done. Remove its worktree?");
  await bar.getByRole("button", { name: "Remove worktree" }).click();
  await expect(bar.getByRole("alert")).toContainText("contains modified or untracked files. Commit or discard them first");

  // Committed (as you'd ask the agent to), it goes; the branch stays.
  git(worktree, "commit", "-qam", "agent's edit");
  await bar.getByRole("button", { name: "Remove worktree" }).click();
  await expect(bar).toContainText("worktree removed · branch kept");
  expect(git(folder, "branch", "--list", branch).trim()).toBe(branch);
  expect(readFileSync(join(folder, "Replay note.md"), "utf8")).toBe(NOTE);
});

}

test("continues a worktree thread in a new thread that shares the worktree", async ({ page }, info) => {
  const folder = projectFolder(info, "worktree-continue");
  writeFileSync(join(folder, "Replay note.md"), NOTE);
  git(folder, "init", "-q");
  git(folder, "add", "-A");
  git(folder, "commit", "-qm", "init");
  const created = await page.request.post("/api/projects", { data: { name: `Continue ${info.project.name}`, workingDirectories: [folder] } });
  const { project } = (await created.json()) as { project: { id: string; vaultId: string } };
  const branch = `wiki-agents/e2e-continue-${info.project.name}`;
  const response = await page.request.post(`/api/vaults/${project.vaultId}/threads`, {
    data: { projectId: project.id, providerInstanceId: "replay", worktree: { branch } },
  });
  expect(response.status()).toBe(201);
  const { thread } = (await response.json()) as { thread: { id: string } };

  await page.goto(`/vaults/${project.vaultId}?thread=${thread.id}`);
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("hello");
  await message.press("Enter");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  // Written by hand: no turn. Where it works is explicit, the worktree by default.
  await page.getByRole("button", { name: "Hand off", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Continue in a new thread" });
  await dialog.getByRole("textbox", { name: "Handoff" }).fill("## Objective\nCarry on in the same worktree.");
  const shared = dialog.getByRole("radio", { name: /This thread's worktree/ });
  await expect(shared).toBeChecked();
  await expect(dialog).toContainText("Shared: both threads work in the same files.");
  await expect(dialog.getByText("Without this worktree's branch or uncommitted changes.")).toBeVisible();
  await expect(dialog.getByText("A clean checkout: it won't have uncommitted work.")).toBeVisible();
  await dialog.getByRole("button", { name: "Start new thread" }).click();

  await expect(page.getByRole("heading", { name: "Continued: hello" })).toBeVisible();
  const bar = page.getByRole("region", { name: "Worktree" });
  await expect(bar).toContainText(`⎇ ${branch}`);
  await expect(bar).toContainText("shared");
  await expect(message).toHaveValue("## Objective\nCarry on in the same worktree.");
  // Still one worktree: the new thread shares the old one's.
  const listed = (await (await page.request.get(`/api/projects/${project.id}/worktrees`)).json()) as { worktrees: Array<{ threadId: string; sharedWith: Array<string> }> };
  expect(listed.worktrees).toHaveLength(1);
  expect(listed.worktrees[0]).toMatchObject({ threadId: thread.id, sharedWith: [expect.any(String)] });

  // Done with the old thread: it doesn't offer to remove the worktree the new one works in.
  await page.getByRole("navigation", { name: "Continuation" }).getByRole("button", { name: "hello" }).click();
  await expect(page.getByRole("heading", { name: "hello", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(bar).toContainText("Shared with another thread: removing it removes it there too.");
  await expect(bar).not.toContainText("This thread is done. Remove its worktree?");
  await expect(bar.getByRole("button", { name: "Remove worktree" })).not.toHaveClass(/offered/);
});
