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
