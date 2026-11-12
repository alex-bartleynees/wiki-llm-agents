import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

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
