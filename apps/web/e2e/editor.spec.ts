import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { e2eRoot, openVault } from "./app.ts";

test("edits a note: link completion, save on idle, following the disk, and a conflict", async ({ page }, info) => {
  // Each width edits its own note; the vault is shared.
  const name = `Editing ${info.project.name}`;
  const file = join(e2eRoot(), "vault", `${name}.md`);
  writeFileSync(file, `# ${name}\n\nFirst line.\n`);

  await openVault(page);
  await page.goto(`${page.url()}?note=${encodeURIComponent(`${name}.md`)}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("group", { name: "Mode" }).getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/&edit$/);

  const source = page.getByRole("textbox", { name: "Note source" });
  const status = page.getByRole("region", { name: "Edit note" }).getByRole("status");
  await expect(source).toContainText("First line.");
  await source.click();
  await page.keyboard.press("Control+End");

  // `[[` and a few letters offer notes from the index; Enter writes the link.
  await page.keyboard.type("See [[brew");
  await expect(page.getByRole("option", { name: /Brewing/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(source).toContainText("See [[Brewing]]");
  await expect(status).toHaveText("Saved");
  expect(readFileSync(file, "utf8")).toBe(`# ${name}\n\nFirst line.\nSee [[Brewing]]`);

  // Changed on disk with nothing unsaved: the editor follows.
  writeFileSync(file, `# ${name}\n\nFirst line.\nSee [[Brewing]]\nFrom Syncthing.\n`);
  await expect(source).toContainText("From Syncthing.");

  // Changed on disk while you type: a conflict, settled by keeping yours.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Mine.");
  writeFileSync(file, `# ${name}\n\nAn agent rewrote this.\n`);
  const conflict = page.getByRole("alert");
  await expect(conflict).toContainText("This note changed on disk");
  await conflict.getByRole("button", { name: "Save this version" }).click();
  await expect(conflict).toBeHidden();
  await expect(status).toHaveText("Saved");
  expect(readFileSync(file, "utf8")).toBe(`# ${name}\n\nFirst line.\nSee [[Brewing]]\nFrom Syncthing.\nMine.`);

  // Reading it again shows the saved note, with the new link working.
  await page.getByRole("group", { name: "Mode" }).getByRole("link", { name: "Read" }).click();
  await expect(page.locator(".prose")).toContainText("Mine.");
  await page.locator(".prose").getByRole("link", { name: "Brewing", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Brewing" })).toBeVisible();
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});
