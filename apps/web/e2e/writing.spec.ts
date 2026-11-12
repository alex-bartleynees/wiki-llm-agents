import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { e2eRoot, isPhone, openVault } from "./app.ts";

const vault = () => join(e2eRoot(), "vault");

/** The vault pane: the sidebar on desktop, the drawer on a phone. */
const vaultPane = async (page: Page, phone: boolean) => {
  if (phone) await page.getByRole("button", { name: "Vault", exact: true }).click();
  return page.getByRole("complementary", { name: "Vault" });
};

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

test("starts a note from a template in the vault's template folder", async ({ page }, info) => {
  const width = info.project.name;
  mkdirSync(join(vault(), "Templates"), { recursive: true });
  writeFileSync(join(vault(), "Templates", `Meeting ${width}.md`), "---\ntags: [meeting]\n---\n# {{title}}\n\nOn {{date:dddd D MMMM YYYY}}.\n\n## Notes\n");

  // The template folder is a vault setting.
  await page.goto("/settings");
  await page.getByLabel("Template folder").fill("Templates/");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. New notes can start from its notes.");
  await expect(page.getByLabel("Template folder")).toHaveValue("Templates");
  await noOverflow(page);

  await openVault(page);
  await page.goto(`${page.url()}?note=${encodeURIComponent("Notes/Brewing.md")}`);
  await expect(page.getByRole("heading", { level: 1, name: "Brewing" })).toBeVisible();
  await (await vaultPane(page, isPhone(info))).getByRole("button", { name: "New note" }).click();

  const dialog = page.getByRole("dialog", { name: "New note" });
  // Next to the open note by default; the template folder isn't offered.
  await expect(dialog.getByLabel("Folder")).toHaveValue("Notes");
  await expect(dialog.getByLabel("Folder").getByRole("option", { name: "Templates" })).toHaveCount(0);
  await dialog.getByLabel("Title").fill(`Standup: ${width}?`);
  await expect(dialog.getByLabel("Path")).toHaveText(`Notes/Standup ${width}.md`);
  await dialog.getByLabel("Template").selectOption({ label: `Meeting ${width}` });
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Create" }).click();

  // It opens in the editor, filled in.
  await expect(page).toHaveURL(/Standup.*&edit$/);
  const source = page.getByRole("textbox", { name: "Note source" });
  await expect(source).toContainText(`# Standup: ${width}?`);
  const file = join(vault(), "Notes", `Standup ${width}.md`);
  expect(readFileSync(file, "utf8")).toMatch(new RegExp(`^---\\ntags: \\[meeting\\]\\n---\\n# Standup: ${width}\\?\\n\\nOn \\w+day \\d{1,2} \\w+ \\d{4}\\.\\n\\n## Notes\\n$`));

  // The same name again is refused, with the way to the note that has it.
  await (await vaultPane(page, isPhone(info))).getByRole("button", { name: "New note" }).click();
  await dialog.getByLabel("Folder").selectOption("Notes");
  await dialog.getByLabel("Title").fill(`Standup ${width}`);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("alert")).toContainText(`There's already a note at Notes/Standup ${width}.md.`);
  await dialog.getByRole("button", { name: "Open it" }).click();
  await expect(dialog).toBeHidden();
  await expect(source).toContainText(`# Standup: ${width}?`);
});

test("adds pasted and chosen images to assets/ and links them", async ({ page }, info) => {
  const name = `Pictures ${info.project.name}`;
  writeFileSync(join(vault(), `${name}.md`), `# ${name}\n\n`);
  await openVault(page);
  await page.goto(`${page.url()}?note=${encodeURIComponent(`${name}.md`)}&edit`);
  const source = page.getByRole("textbox", { name: "Note source" });
  await expect(source).toContainText(name);
  await source.click();
  await page.keyboard.press("Control+End");

  // A 1×1 PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  await source.evaluate((element, bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, [...png]);
  await expect(source).toContainText(/!\[\[Pasted image \d{14}\.png\]\]/);
  const pasted = /!\[\[(Pasted image \d{14}\.png)\]\]/.exec((await source.textContent()) ?? "")?.[1];
  expect(pasted).toBeDefined();
  expect(readFileSync(join(vault(), "assets", pasted ?? ""))).toEqual(png);

  // The Image button (the photo library on a phone) adds a file under its own name.
  await page.keyboard.press("Enter");
  await page.locator('input[type="file"]').setInputFiles({ name: `photo ${info.project.name}.png`, mimeType: "image/png", buffer: png });
  await expect(source).toContainText(`![[photo ${info.project.name}.png]]`);
  expect(existsSync(join(vault(), "assets", `photo ${info.project.name}.png`))).toBe(true);
  await expect(page.getByRole("region", { name: "Edit note" }).getByRole("status")).toHaveText("Saved");
  expect(readFileSync(join(vault(), `${name}.md`), "utf8")).toBe(`# ${name}\n\n![[${pasted}]]\n![[photo ${info.project.name}.png]]`);
  await noOverflow(page);

  // Reading the note shows both.
  await page.getByRole("group", { name: "Mode" }).getByRole("link", { name: "Read" }).click();
  await expect(page.locator(".prose img")).toHaveCount(2);
});

test("lists tags, nested, and shows the notes with one", async ({ page }, info) => {
  const width = info.project.name;
  writeFileSync(join(vault(), `Oolong ${width}.md`), `---\ntags: [drinks/${width}, tea]\n---\n# Oolong ${width}\n`);
  await openVault(page);
  const pane = await vaultPane(page, isPhone(info));
  await pane.getByRole("group", { name: "Sidebar" }).getByRole("button", { name: "Tags" }).click();

  const tags = pane.getByRole("list", { name: "Tags" });
  await expect(tags.getByRole("button", { name: /^#drinks/ })).toBeVisible();
  await expect(tags.getByRole("button", { name: new RegExp(`^#${width}`) })).toBeVisible();
  await noOverflow(page);

  // Folding hides the nested tags; a filter shows matches whatever is folded.
  await tags.getByRole("button", { name: "Tags under #drinks" }).click();
  await expect(tags.getByRole("button", { name: new RegExp(`^#${width}`) })).toBeHidden();
  await pane.getByLabel("Filter tags").fill(width);
  await expect(tags.getByRole("button", { name: /^#tea/ })).toBeHidden();
  await tags.getByRole("button", { name: new RegExp(`^#${width}`) }).click();

  // The search screen, filtered to the tag.
  const search = page.getByRole("search");
  await expect(page.getByRole("button", { name: `Remove tag filter drinks/${width}` })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Oolong ${width}`) })).toBeVisible();
  await expect(search).toBeVisible();
});
