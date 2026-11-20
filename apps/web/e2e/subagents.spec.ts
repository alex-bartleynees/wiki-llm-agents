import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { openVault, tab, useReplay } from "./app.ts";

/**
 * Background subagents, played by replay's `subagents` transcripts: the agent's own
 * turn ends while they work, a subagent's approval is answered in the thread, their
 * reports start a turn of the provider's own, and Stop stops them all.
 */
const startThread = async (page: Page, info: TestInfo, text: string) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(text);
  await message.press("Enter");
};

const subagents = (page: Page) => page.locator("details.subagents");

test("shows subagents working after the turn, answers one's approval, and the turn their reports start", async ({ page }, info) => {
  await startThread(page, info, `Delegate to subagents ${info.project.name}`);

  // The agent's own turn ends while its two subagents work.
  await expect(page.getByText("Launched; I'll report back when they're done.")).toBeVisible();
  const card = subagents(page);
  await expect(card).toContainText("Add a line to Tea.md");
  await expect(card).toContainText("Read Coffee.md");

  // The subagent's approval says who asks, and is answered like any other.
  const approval = page.getByRole("region", { name: "Approval" });
  await expect(approval).toContainText("From subagent · Add a line to Tea.md");
  await expect(card.getByRole("listitem").filter({ hasText: "Add a line to Tea.md" })).toContainText("Waiting for you");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval).toContainText("Approved");

  // Both report; the provider starts a turn by itself, under its divider.
  await expect(page.getByText("2 subagents reported · Add a line to Tea.md, Read Coffee.md")).toBeVisible();
  await expect(page.getByText("Both subagents are done: Tea.md has the new line")).toBeVisible();
  await expect(card.getByRole("status")).toHaveText("2 done");
  const tea = card.getByRole("listitem").filter({ hasText: "Add a line to Tea.md" });
  await tea.getByText("Latest report").click();
  await expect(tea).toContainText("Added 'Oolong too.' to Notes/Tea.md.");
  await expect(page.getByRole("button", { name: "Stop the subagents" })).toHaveCount(0);
});

test("Stop with only subagents working stops them all, and the composer stays usable", async ({ page }, info) => {
  const title = `Work in the background ${info.project.name}`;
  await startThread(page, info, title);
  await expect(page.getByText("Two subagents are working in the background.")).toBeVisible();
  const card = subagents(page);
  await expect(card.getByRole("status")).toHaveText("2 running");

  // The agent is idle: you can send, and a Stop beside Send stops the subagents.
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  const stop = page.getByRole("button", { name: "Stop the subagents" });
  await expect(stop).toBeVisible();

  // Running lists the thread while its subagents work.
  await page.getByRole("link", { name: /^Inbox/ }).click();
  await page.getByRole("navigation", { name: "Inbox view" }).getByRole("link", { name: /^Running/ }).click();
  const row = page.getByRole("region", { name: "Working" }).getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("2 subagents");
  await row.getByRole("link", { name: title }).click();

  await page.getByRole("button", { name: "Stop the subagents" }).click();
  await expect(card.getByRole("status")).toHaveText("2 stopped");
  await expect(page.getByRole("button", { name: "Stop the subagents" })).toHaveCount(0);
  await expect(page.getByText(/subagents? reported/)).toHaveCount(0);
});
