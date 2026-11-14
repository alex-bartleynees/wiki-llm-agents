import { expect, test } from "@playwright/test";
import { openVault, tab, useReplay } from "./app.ts";

/** Starts a replay thread with `text` as its first message. */
const startThread = async (page: import("@playwright/test").Page, info: import("@playwright/test").TestInfo, text: string) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(text);
  await message.press("Enter");
};

const openRunning = async (page: import("@playwright/test").Page) => {
  await page.getByRole("link", { name: /^Inbox/ }).click();
  await page.getByRole("navigation", { name: "Inbox view" }).getByRole("link", { name: /^Running/ }).click();
  await expect(page).toHaveURL(/\/inbox\/running$/);
};

test("follows a turn's plan, finds the thread waiting in Running, and answers it from there", async ({ page }, info) => {
  const title = `Make a plan ${info.project.name}`;
  await startThread(page, info, title);

  const plan = page.getByRole("region", { name: "Plan" });
  await expect(plan).toContainText("1 of 3 done");
  await expect(plan.getByRole("listitem").nth(1)).toContainText(/In progress:\s*Draft a summary/);
  await expect(page.getByRole("region", { name: "Question" })).toBeVisible();

  // The header shows it from any page, without opening the Running tab first. Other
  // specs share the server, so counts are only checked to be there.
  const indicator = page.getByRole("banner").getByRole("link", { name: /\d+ waiting for you/ });
  await expect(indicator).toBeVisible();
  await indicator.click();
  await expect(page).toHaveURL(/\/inbox\/running$/);
  await expect(page.getByRole("navigation", { name: "Inbox view" }).getByRole("link", { name: /^Running\s\(\d+\)$/ })).toBeVisible();
  const waiting = page.getByRole("region", { name: "Waiting for you" });
  const row = waiting.getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("Needs you · 1/3");
  await row.getByRole("link", { name: title }).click();

  await page.getByRole("region", { name: "Question" }).getByRole("button", { name: "_Inbox" }).click();
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);
  await expect(plan).toContainText("3 of 3 done");

  await openRunning(page);
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});

test("lists a failed thread with its reason until it is marked done", async ({ page }, info) => {
  const title = `This will fail ${info.project.name}`;
  await startThread(page, info, title);
  await expect(page.locator(".turn-end").last()).toHaveText(/^Failed/);

  await openRunning(page);
  const row = page.getByRole("region", { name: "Failed or stopped" }).getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("The provider stopped with an error (recorded).");
  await row.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});
