import { expect, test } from "@playwright/test";
import { openVault } from "./app.ts";

test("opens a child from Running, shows it under its manager, and delivers its report", async ({ page }, info) => {
  await openVault(page);
  const vaultPath = new URL(page.url()).pathname;
  const agentId = `manager-fixture-${info.project.name}`;
  const agent = await page.request.put(`/api/agents/${agentId}`, {
    data: {
      baseHash: null,
      agent: {
        name: agentId, description: "", provider: null, model: null, sources: [], mcp: [],
        autonomy: { read: "allow", create: "ask", edit: "ask", commands: "ask", web: "ask", tools: "ask", subagents: "ask", threads: "ask" },
        instructions: "Manage child threads.",
      },
    },
  });
  expect(agent.ok()).toBeTruthy();
  const created = await page.request.post(`/api${vaultPath}/threads`, {
    data: { agentId, providerInstanceId: "replay" },
  });
  expect(created.ok()).toBeTruthy();
  const { thread } = await created.json();

  await page.goto(`${vaultPath}?thread=${thread.id}`);
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(`managerfixture ${info.project.name}`);
  await message.press("Enter");
  const approval = page.getByRole("region", { name: "Approval", exact: true }).filter({ hasText: "Start child thread" });
  await expect(approval.getByText(`Agent · ${agentId}`, { exact: true })).toBeVisible();
  await expect(approval.getByText("Provider · replay", { exact: true })).toBeVisible();
  await expect(approval.getByText("Model · Provider default", { exact: true })).toBeVisible();
  await approval.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("The child thread is ready.")).toBeVisible();

  await page.getByRole("button", { name: "All threads" }).click();
  await expect(page.getByRole("list", { name: "Child threads" }).getByRole("button", { name: `Review the plan ${agentId}`, exact: false })).toBeVisible();

  await page.getByRole("link", { name: /^Inbox/ }).click();
  await page.getByRole("navigation", { name: "Inbox view" }).getByRole("link", { name: /^Running/ }).click();
  const child = page.getByRole("region", { name: "Waiting for you" }).getByRole("listitem").filter({ hasText: "Review the plan" }).filter({
    has: page.getByRole("link", { name: "Manager thread", exact: true }).and(page.locator(`[href="${vaultPath}?thread=${thread.id}"]`)),
  });
  await child.getByRole("link", { name: "Review the plan" }).click();
  const managerLink = page.getByRole("link", { name: "Manager thread" });
  await expect(managerLink).toHaveAttribute("href", `${vaultPath}?thread=${thread.id}`);
  await page.getByRole("button", { name: "_Inbox/", exact: true }).click();
  await managerLink.click();
  await expect(page.getByText("Thread reported", { exact: true })).toBeVisible();
  await page.getByText("Child thread results", { exact: true }).click();
  await expect(page.getByText(/Got it, I'll put it in/)).toBeVisible();

  await page.getByRole("button", { name: "_Inbox", exact: true }).click();
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All threads" }).click();
  await page.getByText(/^done · \d+$/).click();
  await page.getByRole("list", { name: "Done threads" }).getByRole("button", { name: `Review the plan ${agentId}` }).click();
  await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
});
