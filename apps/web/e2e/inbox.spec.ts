import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import { openVault, tab, useReplay } from "./app.ts";

/**
 * Schedules fire on the server's clock, which these flows move with the test hook
 * (`POST /api/test/clock`) instead of waiting.
 */

interface ScheduleSummary {
  readonly id: string;
  readonly title: string;
  readonly nextAt: number | null;
}

/** Moves the server's clock forward; returns its time after. */
const advanceClock = async (request: APIRequestContext, advanceMs: number) => {
  const response = await request.post("/api/test/clock", { data: { advanceMs } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { now: number }).now;
};

/**
 * Moves the server's clock just past the latest of the schedules' next times, in one
 * jump, so each fires once. Firing them one at a time could pass another's time too
 * (a Mon–Sat prompt fired after a Saturday reminder jumps over Sunday's reminder).
 * Each must recur at most daily, so none comes round twice before the latest.
 */
const fire = async (request: APIRequestContext, ...titles: ReadonlyArray<string>) => {
  const { schedules } = (await (await request.get("/api/schedules")).json()) as { schedules: ReadonlyArray<ScheduleSummary> };
  const nextTimes = titles.map((title) => schedules.find((candidate) => candidate.title === title)?.nextAt ?? null);
  for (const nextAt of nextTimes) expect(nextAt).toBeTruthy();
  const now = await advanceClock(request, 1);
  await advanceClock(request, Math.max(1, Math.max(...(nextTimes as Array<number>)) - now + 1000));
};

const newSchedule = async (page: Page) => {
  await page.goto("/inbox/schedules");
  await page.getByRole("link", { name: "New schedule" }).click();
  return page.getByRole("form", { name: "New schedule" });
};

test("creates a reminder and a scheduled prompt, sees both arrive, and opens the run's thread", async ({ page, request }, info) => {
  const reminder = `Stretch (${info.project.name})`;
  const prompt = `Say hello (${info.project.name})`;

  let form = await newSchedule(page);
  await form.getByRole("textbox", { name: "Message" }).fill(reminder);
  await form.getByLabel("Time", { exact: true }).fill("07:15");
  await form.getByRole("button", { name: "Create schedule" }).click();
  const card = page.getByRole("listitem", { name: reminder });
  await expect(card).toContainText("Every day at 07:15");
  await expect(card).toContainText(/Next: .*07:15 NZ[SD]T \(Pacific\/Auckland\)/);

  form = await newSchedule(page);
  await form.getByRole("radio", { name: "Scheduled prompt" }).check();
  await form.getByRole("textbox", { name: "Prompt" }).fill(prompt);
  await form.getByLabel("Repeat").selectOption("weekly");
  await form.getByRole("checkbox", { name: "Sat" }).check();
  await form.getByRole("checkbox", { name: "Sun" }).check();
  await form.getByLabel("Time", { exact: true }).fill("06:45");
  await form.getByLabel("Provider").selectOption({ label: "Replay (recorded, free)" });
  // The Model field says what an empty field means for the provider the run uses.
  await expect(form.getByLabel("Model")).toHaveAttribute("placeholder", "Replay (recorded, free) has no model choice");
  await form.getByRole("button", { name: "Create schedule" }).click();
  await expect(page.getByRole("listitem", { name: prompt })).toContainText("Every day at 06:45");

  await fire(request, reminder, prompt);

  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /Inbox/ }).click();
  await expect(page.getByRole("article", { name: reminder })).toContainText("Reminder");
  const result = page.getByRole("article", { name: prompt });
  await expect(result).toContainText("Scheduled prompt", { timeout: 30_000 });

  await result.getByRole("link", { name: "Open thread" }).click();
  await expect(page).toHaveURL(/\/vaults\/[^/]+\?thread=/);
  await expect(page.locator(".user").first()).toContainText("Scheduled run · unattended");
  await expect(page.locator(".user").first()).toContainText(prompt);
});

test("snoozes an item until later and dismisses it", async ({ page, request }, info) => {
  const title = `Snooze me (${info.project.name})`;
  const form = await newSchedule(page);
  await form.getByRole("textbox", { name: "Message" }).fill(title);
  await form.getByRole("button", { name: "Create schedule" }).click();
  await expect(page.getByRole("listitem", { name: title })).toBeVisible();
  await fire(request, title);

  await page.goto("/inbox");
  const open = page.getByRole("region", { name: "Open" });
  const item = open.getByRole("article", { name: title });
  await expect(item).toBeVisible();
  await item.getByLabel("Snooze").selectOption({ label: "1 hour" });
  await expect(item).toHaveCount(0);
  await expect(page.getByText(/^Snoozed \(\d+\)$/)).toBeVisible();

  await advanceClock(request, 61 * 60_000);
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Dismiss" }).click();
  await expect(item).toHaveCount(0);
});

test("recovers a lost bulk completion response and updates another tab outside Inbox", async ({ page, request, context }, info) => {
  const titles = ["Complete this", "Keep snoozed", "Keep new arrival"].map((title) => `${title} (${info.project.name})`);
  const scheduleIds: string[] = [];
  for (const title of titles) {
    const response = await request.post("/api/schedules", {
      data: { kind: "reminder", text: title, recurrence: { _tag: "daily", time: "09:00" }, timezone: "Pacific/Auckland" },
    });
    expect(response.ok()).toBe(true);
    const { schedule } = (await response.json()) as { schedule: ScheduleSummary };
    scheduleIds.push(schedule.id);
  }
  const run = async (index: number) => {
    expect((await request.post(`/api/schedules/${scheduleIds[index]}/run`, { data: {} })).ok()).toBe(true);
  };
  await run(0);
  await run(1);

  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/threads"));
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const { thread } = (await (await created).json()) as { thread: { id: string } };
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Ask me a question");
  await message.press("Enter");
  await expect(page.getByText("Where should the new note go?", { exact: true })).toBeVisible();

  // Keep these items unread so the second tab's badge exercises the Done event.
  await page.route("**/api/inbox/read", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/inbox");
  const open = (target: Page) => target.getByRole("region", { name: "Open", exact: true });
  const card = (target: Page, index: number) => open(target).getByRole("article", { name: titles[index]! });
  const waiting = open(page).getByRole("article", { name: "Question: Where should the new note go?" }).filter({
    has: page.locator(`a[href$="?thread=${thread.id}"]`),
  });
  const action = page.getByRole("button", { name: "Mark all as done" });
  await expect(waiting.getByRole("link", { name: "Answer in the thread" })).toBeVisible();
  await card(page, 1).getByLabel("Snooze").selectOption({ label: "1 hour" });
  await expect(card(page, 1)).toHaveCount(0);

  const other = await context.newPage();
  await openVault(other);
  const badge = other.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /^Inbox/ }).locator(".badge");
  const unread = async () => {
    const { items } = (await (await request.get("/api/inbox")).json()) as {
      items: Array<{ title: string; kind: string; state: string; read: boolean; snoozedUntil: number | null }>;
    };
    return items.filter((item) => item.state === "open" && !item.read && item.snoozedUntil === null);
  };
  const baseline = (await unread()).length;
  await expect(badge).toHaveAttribute("aria-label", `${baseline} unread`);
  await action.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(/Mark \d+ items? as done\?/);
  await expect(dialog).toContainText("Approvals, questions, snoozed items and new arrivals stay in the inbox.");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(card(page, 0)).toBeVisible();

  await action.click();
  const heading = await dialog.getByRole("heading").textContent();
  const count = Number(heading?.match(/\d+/)?.[0]);
  expect(count).toBeGreaterThan(0);
  await run(2);
  // The badge increment proves that the tab outside Inbox is receiving live events.
  await expect(badge).toHaveAttribute("aria-label", `${baseline + 1} unread`);
  const unreadBefore = await unread();
  const retained = unreadBefore.filter((item) => item.kind === "request" || item.title === titles[2]).length;
  expect(retained).toBeLessThan(unreadBefore.length);
  await expect(dialog.getByRole("heading")).toHaveText(heading!);
  await page.route("**/api/inbox/done", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect((await response.json()).items).toHaveLength(count);
    await route.abort("connectionreset");
  }, { times: 1 });
  await dialog.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(badge).toHaveAttribute("aria-label", `${retained} unread`);

  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Marked/ })).toHaveText("Marked 0 items done.");
  await other.goto("/inbox");
  for (const target of [page, other]) {
    await expect(card(target, 0)).toHaveCount(0);
    await expect(card(target, 2)).toBeVisible();
    await target.getByText("Done and dismissed", { exact: true }).click();
    await expect(target.getByRole("region", { name: "Done and dismissed" }).getByRole("article", { name: titles[0]! })).toBeVisible();
  }
  await expect(waiting).toBeVisible();
  await page.getByText(/^Snoozed \(\d+\)$/).click();
  await expect(page.getByRole("region", { name: "Snoozed" }).getByRole("article", { name: titles[1]! })).toBeVisible();
  await card(page, 2).getByRole("button", { name: "Done", exact: true }).click();
  await expect(action).toBeDisabled();

  await other.close();
  await waiting.getByRole("link", { name: "Answer in the thread" }).click();
  await page.getByRole("button", { name: "_Inbox/", exact: true }).click();
  await expect(page.getByText(/Got it, I'll put it in/)).toBeVisible();
  for (const id of scheduleIds) expect((await request.delete(`/api/schedules/${id}`)).ok()).toBe(true);
});

test("links a reminder to a note found by search, and opens it from the inbox", async ({ page, request }, info) => {
  const title = `Brew (${info.project.name})`;
  const form = await newSchedule(page);
  await form.getByRole("textbox", { name: "Message" }).fill(title);
  // The vault is picked for a new reminder once the vaults load.
  await expect(form.getByLabel("Vault")).not.toHaveValue("");
  const search = form.getByRole("combobox", { name: "Link a note" });
  await search.fill("brew");
  await expect(form.getByRole("listbox", { name: "Notes" }).getByRole("option").first()).toContainText("Notes/Brewing.md");
  await search.press("Enter");
  await expect(form.getByRole("button", { name: "Remove Brewing" })).toBeVisible();

  // A search left unpicked isn't saved silently.
  await form.getByRole("button", { name: "Remove Brewing" }).click();
  await form.getByRole("combobox", { name: "Link a note" }).fill("nothing picked");
  await form.getByRole("button", { name: "Create schedule" }).click();
  await expect(form.getByRole("alert")).toContainText("Pick a note from the list");
  await form.getByRole("combobox", { name: "Link a note" }).fill("brew");
  await form.getByRole("listbox", { name: "Notes" }).getByRole("option", { name: /Brewing/ }).click();

  await form.getByRole("button", { name: "Create schedule" }).click();
  await expect(page.getByRole("listitem", { name: title })).toBeVisible();
  await fire(request, title);

  await page.goto("/inbox");
  await page.getByRole("article", { name: title }).getByRole("link", { name: "Open note" }).click();
  await expect(page).toHaveURL(/note=Notes%2FBrewing\.md|note=Notes\/Brewing\.md/);
});
