import { expect, test } from "@playwright/test";
import { openVault, tab, useReplay } from "./app.ts";

test("starts a thread with a note picked by @, and answers its approval", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();

  const message = page.getByRole("textbox", { name: "Message" });
  await message.click();
  await message.pressSequentially("Please edit the plan @cof");
  const notes = page.getByRole("listbox", { name: "Notes to add" });
  await expect(notes.getByRole("option").first()).toContainText("Coffee");
  // The keyboard picks it; the @name leaves the message and becomes a chip.
  await message.press("Enter");
  const context = page.getByRole("group", { name: "Context for your next message" });
  await expect(context).toContainText("@Coffee");
  await expect(message).toHaveValue("Please edit the plan");

  await message.press("Enter");
  await expect(page.locator(".user").last()).toHaveText("Please edit the plan");
  await expect(context).not.toContainText("@Coffee");

  const approval = page.getByRole("region", { name: "Approval" });
  await approval.getByRole("button", { name: "Apply" }).click();
  await expect(approval).toContainText("Applied");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);
});

test("removes an attached note before sending", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();

  await page.getByRole("button", { name: "+ add" }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  await expect(message).toHaveValue("@");
  await message.pressSequentially("tea");
  await page.getByRole("listbox", { name: "Notes to add" }).getByRole("option", { name: /Tea/ }).click();
  const context = page.getByRole("group", { name: "Context for your next message" });
  await context.getByRole("button", { name: "Remove Tea" }).click();
  await expect(context).not.toContainText("@Tea");
});

test("marks a thread done, finds it in the Done group, and reopens it", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();

  const title = `Wrap up ${info.project.name}`;
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(title);
  await message.press("Enter");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText("✓ done")).toBeVisible();
  // Reopen and mark it done again.
  await page.getByRole("button", { name: "Reopen" }).click();
  await page.getByRole("button", { name: "Mark done" }).click();

  await page.getByRole("button", { name: "All threads" }).click();
  await expect(page.getByRole("list", { name: "Open threads" })).not.toContainText(title);
  const doneThreads = page.getByRole("list", { name: "Done threads" });
  await expect(doneThreads).toBeHidden();
  await page.getByText(/^done · \d+$/).click();
  await doneThreads.getByRole("button", { name: title }).click();

  // A new message reopens it.
  await expect(page.getByText("✓ done")).toBeVisible();
  await message.fill("Carry on");
  await message.press("Enter");
  await expect(page.locator(".user").last()).toHaveText("Carry on");
  await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible();
  await page.getByRole("button", { name: "All threads" }).click();
  await expect(page.getByRole("list", { name: "Open threads" })).toContainText(title);
});


test("keeps separate message drafts across navigation and reload, clearing only after sending", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  const draft = "An unfinished thought\nwith another line  ";
  await message.fill(draft);
  await page.reload();
  await tab(page, info, "Chat");
  await expect(message).toHaveValue(draft);

  await page.getByRole("button", { name: "All threads" }).click();
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(message).toHaveValue("");
  await message.fill("Another thread");
  await message.press("Enter");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);
  await page.getByRole("button", { name: "All threads" }).click();
  await page.getByRole("list", { name: "Open threads" }).getByRole("button", { name: /^New thread/ }).first().click();
  await expect(message).toHaveValue(draft);

  await page.goto("/settings");
  await openVault(page);
  await tab(page, info, "Chat");
  await expect(message).toHaveValue(draft);
  await message.press("Enter");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);
  await page.reload();
  await tab(page, info, "Chat");
  await expect(message).toHaveValue("");
});


test("resumes a draft in an independent browser session", async ({ page, browser }, info) => {
  await openVault(page);
  const vaultUrl = page.url();
  await tab(page, info, "Chat");
  await useReplay(page);
  const created = page.waitForResponse((response) => response.request().method() === "POST" && /\/threads$/.test(response.url()));
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const { thread } = await (await created).json() as { thread: { id: string } };
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/threads/${thread.id}/draft`));
  await page.getByRole("textbox", { name: "Message" }).fill("Continue this on my phone");
  expect((await saved).ok()).toBe(true);

  const device = await browser.newContext({ viewport: info.project.use.viewport ?? null });
  try {
    const other = await device.newPage();
    await other.goto(`${vaultUrl}?thread=${thread.id}`);
    await tab(other, info, "Chat");
    await expect(other.getByRole("textbox", { name: "Message" })).toHaveValue("Continue this on my phone");
  } finally {
    await device.close();
  }
});
