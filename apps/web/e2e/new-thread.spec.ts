import { expect, test } from "@playwright/test";
import { isPhone, projectFolder, useReplay } from "./app.ts";

for (const entry of ["overview", "threads"] as const) {
  test(`new-thread choices from ${entry} stay visible and errors allow retry`, async ({ page }, info) => {
    const registered = await page.request.post("/api/projects", { data: { name: `Choices ${entry} ${info.project.name}`, workingDirectories: [projectFolder(info, `choices-${entry}`)] } });
    const { project } = await registered.json();
    // Model discovery stood in for; the missing provider still refuses creation on the real server.
    await page.route("**/api/providers/claude-code/models", route => route.fulfill({ json: { models: [{ id: "haiku", name: "Haiku", free: false, images: true }], defaultModel: "haiku" } }));
    await page.goto(`/projects/${project.id}${entry === "threads" ? "/threads" : ""}`);
    const form = page.getByRole("form", { name: "New thread", exact: true });
    await expect(form.getByRole("checkbox", { name: "Worktree" })).toBeHidden();
    await form.getByLabel("Provider for new threads").selectOption("claude-code");
    await form.getByLabel("Model for new threads").selectOption("haiku");
    const button = form.getByRole("button", { name: entry === "threads" ? "New thread" : "New thread here", exact: true });
    const request = page.waitForRequest(req => req.method() === "POST" && req.url().endsWith("/threads"));
    await button.click();
    expect((await request).postDataJSON()).toMatchObject({ providerInstanceId: "claude-code", model: "haiku", projectId: project.id });
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(form.getByLabel("Model for new threads")).toHaveValue("haiku");
    await useReplay(page);
    await expect(form.getByLabel("Model for new threads")).toBeHidden();
    const created = page.waitForResponse(res => res.request().method() === "POST" && res.url().endsWith("/threads") && res.status() === 201);
    await button.click();
    const { thread } = await (await created).json();
    expect(thread).toMatchObject({ projectId: project.id, providerInstanceId: "replay", model: null });
    await expect(page).toHaveURL(`/projects/${project.id}/threads`);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
    if (isPhone(info)) await page.getByRole("button", { name: "All threads" }).click();
    await page.getByRole("navigation", { name: "Project view" }).getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByLabel("Provider for new threads")).toHaveValue("replay");
    await page.getByLabel("Provider for new threads").selectOption("claude-code");
    await expect(page.getByLabel("Model for new threads")).toHaveValue("haiku");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
