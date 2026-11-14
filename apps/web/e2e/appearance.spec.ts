import { expect, test, type Page } from "@playwright/test";

const html = (page: Page) => page.locator("html");
const token = (page: Page, name: string) =>
  page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);

test("a theme chosen in Settings applies at once and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  const themes = page.getByRole("group", { name: "Theme" });
  await expect(themes.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(html(page)).toHaveAttribute("data-theme", "light");

  // System follows the device.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveAttribute("data-theme", "dark");

  await themes.getByRole("radio", { name: "Gruvbox Dark Hard" }).click();
  await expect(html(page)).toHaveAttribute("data-theme", "gruvbox-dark-hard");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(29, 32, 33)");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#282828");

  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "gruvbox-dark-hard");
  await expect(themes.getByRole("radio", { name: "Gruvbox Dark Hard" })).toBeChecked();

  await themes.getByRole("radio", { name: "Light" }).click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");

  // The page fits a phone's width with the theme cards and font fields.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("fonts chosen in Settings override the bundled ones and survive a reload", async ({ page }) => {
  await page.goto("/settings");
  const code = page.getByRole("group", { name: "Code font" });
  await expect(code.getByRole("combobox")).toHaveValue("default");
  expect(await token(page, "--font-mono")).toContain("IBM Plex Mono");

  await code.getByRole("combobox").selectOption("custom");
  await code.getByRole("textbox", { name: "Code font name" }).fill("JetBrains Mono");
  await page.getByRole("group", { name: "Interface font" }).getByRole("combobox").selectOption("system");
  expect(await token(page, "--font-mono")).toBe('"JetBrains Mono", ui-monospace, monospace');
  expect(await token(page, "--font-ui")).toBe("system-ui, sans-serif");

  await page.reload();
  expect(await token(page, "--font-mono")).toBe('"JetBrains Mono", ui-monospace, monospace');
  await expect(code.getByRole("textbox", { name: "Code font name" })).toHaveValue("JetBrains Mono");

  await code.getByRole("combobox").selectOption("default");
  await expect(code.getByRole("textbox")).toHaveCount(0);
  expect(await token(page, "--font-mono")).toContain("IBM Plex Mono");
});


test("installed fonts can be filtered, chosen and remembered", async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", { configurable: true, value: async () => [
      { family: "Iosevka" }, { family: "JetBrainsMono Nerd Font Mono" }, { family: "Iosevka" },
    ] });
  });
  await page.goto("/settings");
  const code = page.getByRole("group", { name: "Code font" });
  await code.getByRole("combobox").selectOption("custom");
  await expect(code.getByRole("listbox")).toHaveCount(0);
  await code.getByRole("button", { name: "Choose installed font…" }).click();
  const fonts = code.getByRole("listbox", { name: "Installed Code font" });
  await expect(fonts.getByRole("option")).toHaveCount(2);
  await code.getByRole("searchbox", { name: "Filter Code fonts" }).fill("nerd");
  await expect(fonts.getByRole("option")).toHaveCount(1);
  await fonts.selectOption("JetBrainsMono Nerd Font Mono");
  await expect(code.getByRole("textbox", { name: "Code font name" })).toHaveValue("JetBrainsMono Nerd Font Mono");
  await expect(code.locator(".sample")).toHaveCSS("font-family", /JetBrainsMono Nerd Font Mono/);
  if (info.project.name === "phone") {
    await expect(code.getByRole("textbox", { name: "Code font name" })).toHaveCSS("font-size", "16px");
    await expect(code.getByRole("searchbox")).toHaveCSS("font-size", "16px");
    await expect(fonts).toHaveCSS("font-size", "16px");
  }
  await page.screenshot({ path: info.outputPath("font-picker.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(code.getByRole("textbox", { name: "Code font name" })).toHaveValue("JetBrainsMono Nerd Font Mono");
});

test("denied font discovery leaves manual entry usable and can be retried", async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window, "queryLocalFonts", { configurable: true, value: async () => {
      if (calls++ === 0) throw new DOMException("Denied", "NotAllowedError");
      return [{ family: "Iosevka" }];
    } });
  });
  await page.goto("/settings");
  const code = page.getByRole("group", { name: "Code font" });
  await code.getByRole("combobox").selectOption("custom");
  await code.getByRole("button", { name: "Choose installed font…" }).click();
  await expect(code.getByRole("status").filter({ hasText: "Font access wasn't allowed" })).toBeVisible();
  await code.getByRole("textbox", { name: "Code font name" }).fill("Hack Nerd Font Mono");
  expect(await token(page, "--font-mono")).toContain("Hack Nerd Font Mono");
  await code.getByRole("button", { name: "Choose installed font…" }).click();
  await expect(code.getByRole("option", { name: "Iosevka" })).toBeVisible();
});

test("unsupported browsers keep manual font selection", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "queryLocalFonts", { configurable: true, value: undefined }));
  await page.goto("/settings");
  const code = page.getByRole("group", { name: "Code font" });
  await code.getByRole("combobox").selectOption("custom");
  await expect(code.getByRole("button", { name: "Choose installed font…" })).toHaveCount(0);
  await expect(code.getByText("This browser can't list installed fonts.", { exact: false })).toBeVisible();
  await code.getByRole("textbox", { name: "Code font name" }).fill("Iosevka");
  expect(await token(page, "--font-mono")).toContain("Iosevka");
});

test("empty font discovery explains the manual fallback", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "queryLocalFonts", { configurable: true, value: async () => [] }));
  await page.goto("/settings");
  const code = page.getByRole("group", { name: "Code font" });
  await code.getByRole("combobox").selectOption("custom");
  await code.getByRole("button", { name: "Choose installed font…" }).click();
  await expect(code.getByRole("status").filter({ hasText: "No fonts were shared" })).toBeVisible();
  await expect(code.getByRole("textbox", { name: "Code font name" })).toBeEditable();
});
