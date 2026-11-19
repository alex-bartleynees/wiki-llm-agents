import { expect, test } from "@playwright/test";
import { projectFolder } from "./app.ts";

test("gives a project's threads an MCP server, chosen on the project page", async ({ page }, info) => {
  const width = info.project.name;
  const serverId = `team-${width}`;
  const server = { title: `Team tools ${width}`, transport: { type: "http", url: "http://127.0.0.1:9/mcp", headers: {} }, scope: "app", default: false, access: null, oauth: null };
  expect((await page.request.put(`/api/mcp-servers/${serverId}`, { data: { baseHash: null, server } })).status()).toBe(200);
  const response = await page.request.post("/api/projects", { data: { name: `MCP ${width}`, workingDirectories: [projectFolder(info, "project-mcp")] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };

  await page.goto(`/projects/${project.id}`);
  const section = page.getByRole("region", { name: "MCP servers" });
  await expect(section.getByRole("heading")).toHaveText("mcp servers · 0");
  const box = section.getByRole("checkbox", { name: new RegExp(`Team tools ${width}`) });
  await expect(box).not.toBeChecked();
  await expect(section.getByRole("button", { name: "Save MCP servers" })).toBeDisabled();

  await box.check();
  await section.getByRole("button", { name: "Save MCP servers" }).click();
  await expect(section.getByRole("status")).toHaveText("Saved.");
  await expect(section.getByRole("heading")).toHaveText("mcp servers · 1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  // Saved on the server, for every thread in the project.
  await page.reload();
  await expect(box).toBeChecked();
  const saved = (await (await page.request.get(`/api/projects/${project.id}/mcp-servers`)).json()) as { serverIds: Array<string> };
  expect(saved.serverIds).toEqual([serverId]);

  // A server since removed from Settings stays listed until unticked.
  expect((await page.request.put(`/api/projects/${project.id}/mcp-servers`, { data: { serverIds: [serverId, "gone"] } })).status()).toBe(200);
  await page.reload();
  const gone = section.getByRole("checkbox", { name: /gone/ });
  await expect(gone).toBeChecked();
  await expect(section).toContainText("not in Settings");
  await gone.uncheck();
  await box.uncheck();
  await section.getByRole("button", { name: "Save MCP servers" }).click();
  await expect(section.getByRole("heading")).toHaveText("mcp servers · 0");
});
