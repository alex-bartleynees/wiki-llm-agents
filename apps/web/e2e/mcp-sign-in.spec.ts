import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { e2eRoot } from "./app.ts";
import { type StandInIdentity, startStandInIdentity } from "./stand-in-identity.ts";

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

let identity: StandInIdentity;
test.beforeAll(async () => {
  identity = await startStandInIdentity();
});
test.afterAll(async () => {
  await identity.close();
});

test("signs in to an MCP server through its identity server, signs out, and finishes from a pasted address", async ({ page }, info) => {
  const width = info.project.name;
  const title = `Coffee ${width}`;
  const id = `coffee-${width}`;
  await page.goto("/settings");

  // Added as Netclaw had the coffee journal: a client id and a scope, no header.
  await page.getByRole("button", { name: "Add server" }).click();
  const form = page.getByRole("form", { name: "New MCP server" });
  await form.getByLabel("Server name").fill(title);
  await form.getByLabel("URL").fill(identity.mcpUrl);
  await form.getByLabel("Sign-in client id").fill("coffee-journal-ai-agent");
  await form.getByLabel("Sign-in scopes").fill("journal:read");
  await noOverflow(page);
  await form.getByRole("button", { name: "Add" }).click();

  const item = page.getByRole("list", { name: "MCP servers" }).getByRole("listitem", { name: title });
  await expect(item).toContainText("Not signed in");
  expect(readFileSync(join(e2eRoot(), "config", "mcp", `${id}.yaml`), "utf8")).toContain("oauth:\n  clientId: coffee-journal-ai-agent\n  scopes:\n    - journal:read\n");
  await item.getByRole("button", { name: `Connect ${title}` }).click();
  const signIn = page.getByRole("region", { name: `Sign in to ${title}` });
  await expect(signIn).toContainText("/api/mcp-servers/oauth/callback");
  await noOverflow(page);

  // The sign-in page opens in a new tab and comes back to Settings there; this tab hears of it.
  const [popup] = await Promise.all([page.waitForEvent("popup"), signIn.getByRole("link", { name: "Open the sign-in page" }).click()]);
  await expect(popup.getByRole("status").filter({ hasText: `Signed in to ${id}.` })).toBeVisible();
  await expect(popup).toHaveURL(/\/settings$/);
  await popup.close();
  await expect(item).toContainText("Signed in; renewed automatically");
  await expect(signIn).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: `Signed in to ${title}.` })).toBeVisible();
  expect(identity.authorizations.at(-1)).toMatchObject({ client_id: "coffee-journal-ai-agent", code_challenge_method: "S256", scope: "journal:read offline_access", resource: identity.mcpUrl });
  await noOverflow(page);

  await item.getByRole("button", { name: `Sign out of ${title}` }).click();
  await expect(item).toContainText("Not signed in");

  // Signed in on another device: the address it ends at is pasted here.
  await item.getByRole("button", { name: `Connect ${title}` }).click();
  const link = await signIn.getByRole("link", { name: "Open the sign-in page" }).getAttribute("href");
  const answer = await fetch(link ?? "", { redirect: "manual" });
  await signIn.getByLabel("Address after signing in").fill(answer.headers.get("location") ?? "");
  await signIn.getByRole("button", { name: "Finish signing in" }).click();
  await expect(item).toContainText("Signed in; renewed automatically");
  await expect(signIn).toHaveCount(0);

  // The same address again finishes nothing, and says so.
  await item.getByRole("button", { name: `Reconnect ${title}` }).click();
  await signIn.getByLabel("Address after signing in").fill(answer.headers.get("location") ?? "");
  await signIn.getByRole("button", { name: "Finish signing in" }).click();
  await expect(page.getByRole("alert")).toContainText("isn't a sign-in the app is waiting for");
  await noOverflow(page);
});
