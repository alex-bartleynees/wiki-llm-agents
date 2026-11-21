import { expect, test } from "@playwright/test";
import { openVault, tab, useReplay } from "./app.ts";

test("sets thread inactivity and moves an open thread to Done live", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const title = `Inactivity ${info.project.name}`;
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(title);
  await message.press("Enter");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  const settings = await page.context().newPage();
  try {
    await settings.goto("/settings");
    const enabled = settings.getByRole("checkbox", { name: "Automatically mark inactive threads as done" });
    const days = settings.getByRole("spinbutton", { name: "Days of inactivity" });
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await days.fill("1");
    await settings.getByRole("button", { name: "Save thread settings" }).click();
    await expect(settings.getByRole("status").filter({ hasText: "Thread settings saved." })).toBeVisible();

    expect((await page.request.post("/api/test/clock", { data: { advanceMs: 24 * 60 * 60 * 1000 } })).ok()).toBe(true);
    const reason = page.getByText("Marked done after inactivity");
    await expect(reason).toBeVisible();

    await page.getByRole("button", { name: "All threads" }).click();
    await expect(page.getByRole("list", { name: "Open threads" })).not.toContainText(title);
    await page.getByText(/^done · \d+$/).click();
    await page.getByRole("list", { name: "Done threads" }).getByRole("button", { name: title }).click();
    await expect(reason).toBeVisible();
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(reason).toBeHidden();
    await message.fill("Continue after reopening");
    await message.press("Enter");
    await expect(page.locator(".user").last()).toHaveText("Continue after reopening");

    await settings.reload();
    await expect(enabled).toBeChecked();
    await expect(days).toHaveValue("1");
    await enabled.uncheck();
    await settings.getByRole("button", { name: "Save thread settings" }).click();
    await expect(settings.getByRole("status").filter({ hasText: "Thread settings saved." })).toBeVisible();
    await settings.reload();
    await expect(days).toHaveValue("1");
    await expect(enabled).not.toBeChecked();
  } finally {
    await settings.close();
  }
});
