import { expect, test } from "@playwright/test";

test("settings list the providers with whether each can run turns", async ({ page }) => {
  await page.goto("/settings");
  const list = page.getByRole("list", { name: "Providers" });
  // The flows point OpenCode and Claude Code at missing binaries; replay is built in.
  const opencode = list.getByRole("listitem", { name: "OpenCode" });
  const claude = list.getByRole("listitem", { name: "Claude Code" });
  const replay = list.getByRole("listitem", { name: "Replay (recorded, free)" });
  await expect(replay.getByText("Ready")).toBeVisible();
  await expect(replay.getByText("Built in")).toBeVisible();
  await expect(claude.getByText("Unavailable")).toBeVisible();
  await expect(claude.getByText(/Claude Code isn't installed/)).toBeVisible();
  await expect(opencode.getByText("Unavailable")).toBeVisible();

  await claude.getByRole("button", { name: "Check again" }).click();
  await expect(claude.getByText(/Claude Code isn't installed/)).toBeVisible();
});
