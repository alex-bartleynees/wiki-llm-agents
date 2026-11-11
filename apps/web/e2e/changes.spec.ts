import { expect, test } from "@playwright/test";
import { openVault, tab, useReplay } from "./app.ts";

test("applies an agent's proposed edit, reviews the change, and undoes it", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Please edit the note");
  await message.press("Enter");

  // The approval shows the proposed edit as a diff, answered with Apply.
  const approval = page.getByRole("region", { name: "Approval" });
  await expect(approval).toContainText("Proposed edit");
  await expect(approval.getByLabel("Proposed change to Replay note.md")).toContainText("+- A line added by the replay agent.");
  await approval.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  // The turn's card lists the note it changed, with its diff.
  const change = page.getByRole("region", { name: "Changes in this turn" }).last().getByRole("listitem", { name: "Edited Replay note.md" });
  await expect(change).toContainText("+1");
  await change.getByText("Diff", { exact: true }).click();
  await expect(change.getByLabel("Diff of Replay note.md")).toContainText("+- A line added by the replay agent.");

  // The note says an agent edited it.
  await change.getByRole("link", { name: "Replay note.md" }).click();
  await tab(page, info, "Wiki");
  const added = page.locator("article .prose li", { hasText: "A line added by the replay agent." });
  await expect(added.first()).toBeVisible();
  const before = await added.count();
  await expect(page.locator("article .meta")).toContainText(/edited by replay/i);

  // Undo puts the note back; the open note follows.
  await tab(page, info, "Chat");
  await change.getByRole("button", { name: "Undo" }).click();
  await expect(change).toContainText("Undone");
  await expect(change.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await tab(page, info, "Wiki");
  await expect(added).toHaveCount(before - 1);
});

test("refuses to undo a change made over since, and shows the three versions", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  for (const turn of [1, 2]) {
    const message = page.getByRole("textbox", { name: "Message" });
    await message.fill("Please edit the note");
    await message.press("Enter");
    const approval = page.getByRole("region", { name: "Approval" }).last();
    await approval.getByRole("button", { name: "Apply" }).click();
    await expect(page.locator(".turn-end")).toHaveCount(turn);
  }

  // The first turn's edit was edited again by the second, so undoing it would lose that.
  const first = page.getByRole("region", { name: "Changes in this turn" }).first().getByRole("listitem", { name: "Edited Replay note.md" });
  await first.getByRole("button", { name: "Undo" }).click();
  await expect(first.getByRole("alert")).toContainText("The file has changed since this turn");
  const versions = first.getByRole("group", { name: "Versions of Replay note.md" });
  await expect(versions.getByRole("region", { name: "Before the turn" })).toBeVisible();
  await expect(versions.getByRole("region", { name: "As the turn left it" })).toBeVisible();
  await expect(versions.getByRole("region", { name: "Now" })).toBeVisible();
});
