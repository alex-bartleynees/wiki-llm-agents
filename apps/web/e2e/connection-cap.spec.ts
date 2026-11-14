import { expect, test, type Page } from "@playwright/test";
import { openVault, tab, useReplay } from "./app.ts";

/**
 * Over HTTP/1.1 a browser keeps at most six connections per host, shared by every tab,
 * and each open event stream holds one. Two tabs on a vault with a thread open must
 * still get answers to ordinary requests.
 */

/** Asks the server something small from the page; false if no answer in 5 s. */
const answers = (page: Page) =>
  page.evaluate(async () => {
    try {
      const response = await fetch("/health", { signal: AbortSignal.timeout(5000) });
      return response.ok;
    } catch {
      return false;
    }
  });

// With a stream per store, the first tab held four connections, the second tab's first
// two used up the six, and its thread never loaded. Now each tab holds one.
test("two tabs with a thread open still get answers", async ({ context, page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(`Two tabs ${info.project.name}`);
  await message.press("Enter");
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);
  expect(await answers(page)).toBe(true);

  // The second tab reopens the remembered thread, so it follows the same streams.
  const second = await context.newPage();
  await openVault(second);
  await tab(second, info, "Chat");
  await expect(second.locator(".turn-end").last()).toHaveText(/^Done/);

  expect(await answers(second)).toBe(true);
  expect(await answers(page)).toBe(true);
});
