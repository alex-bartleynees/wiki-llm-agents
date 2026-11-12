import { expect, test } from "@playwright/test";
import { isPhone, openVault } from "./app.ts";

test("reads notes: the file tree, a wiki link, and the quick switcher", async ({ page }, info) => {
  await openVault(page);

  // The tree is a drawer on a phone.
  if (isPhone(info)) await page.getByRole("button", { name: "Vault", exact: true }).click();
  await page.getByRole("complementary", { name: "Vault" }).getByRole("link", { name: "Coffee", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Coffee" })).toBeVisible();

  await page.locator(".prose").getByRole("link", { name: "Tea", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tea" })).toBeVisible();
  await expect(page).toHaveURL(/note=Tea\.md/);

  await page.keyboard.press("Control+k");
  const switcher = page.getByRole("dialog", { name: "Open a note" });
  await switcher.getByLabel("Note title or path").fill("brew");
  await expect(switcher.getByRole("option").first()).toContainText("Brewing");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Brewing" })).toBeVisible();
});

test("shows the sections in the header, with the wiki current", async ({ page }) => {
  await openVault(page);
  const sections = page.getByRole("navigation", { name: "Sections" });
  await expect(sections.getByRole("link", { name: "Wiki" })).toHaveAttribute("aria-current", "page");
  await sections.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(sections.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
});

test("renders Mermaid diagrams and preserves invalid and ordinary code", async ({ page }) => {
  await openVault(page);
  await page.goto(`${page.url()}?note=Diagrams.md`);
  const diagrams = page.locator(".mermaid-diagram");
  await expect(diagrams).toHaveCount(2);
  await expect(diagrams.first().locator("svg")).toBeVisible();
  await expect(diagrams.first()).toContainText("Finish");
  await diagrams.first().getByText("Diagram source", { exact: true }).click();
  await expect(diagrams.first().locator("pre")).toContainText("flowchart LR");
  await expect(diagrams.last().getByRole("status")).toContainText("Could not render");
  await expect(diagrams.last().locator("pre")).toBeVisible();
  await expect(page.locator("code.language-js")).toHaveText("const ordinary = true;\n");
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});
