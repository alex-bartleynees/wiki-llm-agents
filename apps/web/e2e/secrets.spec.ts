import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { e2eRoot } from "./app.ts";

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

test("adds a secret in Settings, replaces it without seeing it, and forgets it", async ({ page }, info) => {
  const width = info.project.name;
  const name = `github-${width}`;
  const value = `ghp_e2e_${width}_do_not_show`;
  // A server that refers to the secret, written as in Settings › MCP servers.
  mkdirSync(join(e2eRoot(), "config", "mcp"), { recursive: true });
  writeFileSync(
    join(e2eRoot(), "config", "mcp", `uses-${name}.yaml`),
    `title: Uses ${name}\ntransport:\n  type: http\n  url: https://example.com/mcp\n  headers:\n    Authorization: Bearer \${secret:${name}}\n`,
  );

  await page.goto("/settings");
  const list = page.getByRole("list", { name: "Secrets" });
  // Declared in the service's configuration: listed, with nothing to change here.
  const declared = list.getByRole("listitem", { name: "jira" });
  await expect(declared).toContainText("declared file");
  await expect(declared.getByRole("button")).toHaveCount(0);

  await page.getByRole("button", { name: "Add secret" }).click();
  const form = page.getByRole("form", { name: "New secret" });
  await form.getByLabel("Secret name").fill("GitHub");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form.getByRole("alert")).toContainText("Name: lowercase letters");
  await expect(form.getByRole("alert")).toContainText("Value: paste the secret's value.");
  await form.getByLabel("Secret name").fill(name);
  await expect(form).toContainText(`\${secret:${name}}`);
  await expect(form.getByLabel("Secret value")).toHaveAttribute("type", "password");
  await form.getByLabel("Secret value").fill(value);
  await form.getByLabel("Expires").fill("2099-01-31");
  await noOverflow(page);
  await form.getByRole("button", { name: "Add" }).click();

  const item = list.getByRole("listitem", { name });
  await expect(page.getByRole("status").filter({ hasText: `Added ${name}.` })).toBeVisible();
  await expect(item).toContainText(`\${secret:${name}}`);
  await expect(item).toContainText("stored");
  await expect(item).toContainText(/expires .*2099/);
  await expect(item).toContainText(`used by uses-${name}`);
  await expect(page.getByText(/a file only you can read/)).toBeVisible();
  // The value is nowhere on the page, nor in the file on disk.
  await expect(page.locator("body")).not.toContainText(value);
  const file = join(e2eRoot(), "data", "secrets", "secrets.enc");
  expect(readFileSync(file, "utf8")).not.toContain(value);
  expect(statSync(file).mode & 0o777).toBe(0o600);

  // Replace: the form starts empty, never with the old value.
  await item.getByRole("button", { name: `Replace ${name}` }).click();
  const replace = page.getByRole("form", { name: `Replace ${name}` });
  await expect(replace.getByLabel("Secret name")).toBeDisabled();
  await expect(replace.getByLabel("Secret value")).toHaveValue("");
  await expect(replace.getByLabel("Expires")).toHaveValue("2099-01-31");
  await replace.getByLabel("Secret value").fill(`${value}_2`);
  await replace.getByLabel("Expires").fill("");
  await replace.getByRole("button", { name: "Replace" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Replaced ${name}.` })).toBeVisible();
  await expect(item).not.toContainText("expires");

  // Forget it: a server still uses it, so the app says so first.
  await item.getByRole("button", { name: `Delete ${name}` }).click();
  await expect(item).toContainText(`uses-${name} uses it and will have no secret`);
  await item.getByRole("button", { name: "Keep it" }).click();
  await item.getByRole("button", { name: `Delete ${name}` }).click();
  await noOverflow(page);
  await item.getByRole("button", { name: `Forget ${name} anyway` }).click();
  await expect(page.getByRole("status").filter({ hasText: `Deleted ${name}; uses-${name} now has no secret.` })).toBeVisible();
  await expect(item).toHaveCount(0);
  await noOverflow(page);
});
