import { createECDH, randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";

/**
 * Turning notifications on, a test, and a reminder reaching the device, through the
 * real server: a stand-in push service on localhost receives what the server sends
 * (signed and encrypted for real). Headless Chromium has no push service of its own,
 * so the page's `PushManager` hands out a subscription to the stand-in.
 */

interface Received {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly bytes: number;
}

let pushService: Server;
let received: Array<Received> = [];

test.beforeAll(async () => {
  pushService = createServer((request, response) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ path: request.url ?? "", headers: request.headers, bytes: Buffer.concat(chunks).length });
      response.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => pushService.listen(0, "127.0.0.1", resolve));
});

test.afterAll(() => new Promise<void>((resolve) => pushService.close(() => resolve())));

/** A subscription to the stand-in, with real keys so the server can encrypt for it. */
const fakeSubscription = (name: string) => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const { port } = pushService.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}/push/${name}`,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
};

/** Permission granted (headless Chromium says "denied" whatever it is given), and `PushManager` subscribing to the stand-in. */
const stubPush = async (page: Page, subscription: ReturnType<typeof fakeSubscription>) => {
  await page.addInitScript((json) => {
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
    Notification.requestPermission = async () => "granted";
    // Kept across reloads, as a real subscription is.
    const KEY = "e2e:push-subscription";
    const make = () => ({ endpoint: json.endpoint, toJSON: () => json, unsubscribe: async () => (localStorage.removeItem(KEY), true) });
    PushManager.prototype.subscribe = async function () {
      localStorage.setItem(KEY, "1");
      return make() as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async function () {
      return localStorage.getItem(KEY) === null ? null : (make() as unknown as PushSubscription);
    };
  }, subscription);
};

test("turns notifications on, sends a test, gets a reminder that opens its item, and turns them off", async ({ page, request }, info) => {
  received = [];
  const name = info.project.name;
  await stubPush(page, fakeSubscription(name));

  await page.goto("/inbox/notifications");
  await page.getByRole("button", { name: "Enable notifications" }).click();
  await expect(page.getByText(/Notifications are on for/)).toBeVisible();
  const devices = page.getByRole("region", { name: "Devices" });
  const thisDevice = devices.getByRole("listitem").filter({ hasText: "this device" });
  await expect(thisDevice).toContainText("127.0.0.1");

  await thisDevice.getByRole("button", { name: "Send test" }).click();
  await expect(thisDevice.getByRole("status")).toContainText("Sent.");
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ path: `/push/${name}`, headers: { "content-encoding": "aes128gcm", urgency: "high" } });
  expect(received[0]!.headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
  expect(received[0]!.bytes).toBeGreaterThan(0);

  // A reminder arrives as a notification, and the inbox says where it went.
  const text = `Push me (${name})`;
  const created = await request.post("/api/schedules", {
    data: { kind: "reminder", text, recurrence: { _tag: "daily", time: "09:00" }, timezone: "Pacific/Auckland" },
  });
  const { schedule } = (await created.json()) as { schedule: { id: string } };
  expect((await request.post(`/api/schedules/${schedule.id}/run`, { data: {} })).ok()).toBe(true);
  // Opened once the push went out: a page opened sooner may miss the update.
  await expect
    .poll(async () => {
      const { items } = (await (await request.get("/api/inbox")).json()) as {
        items: ReadonlyArray<{ title: string; deliveries: ReadonlyArray<{ channel: string; status: string }> }>;
      };
      return items.find((item) => item.title === text)?.deliveries.find((delivery) => delivery.channel === "web-push")?.status;
    })
    .toBe("sent");
  await page.goto("/inbox");
  const card = page.getByRole("article", { name: text });
  await expect(card).toContainText(/Notifications: Sent to .+\./);
  expect(received.map((push) => push.path)).toEqual([`/push/${name}`, `/push/${name}`]);

  // Tapping it opens the inbox with the item picked out.
  const id = (await card.getAttribute("id"))!.replace("inbox-item-", "");
  await page.goto(`/inbox?item=${id}`);
  await expect(page.locator(`#inbox-item-${id}`)).toHaveClass(/picked/);

  await page.goto("/inbox/notifications");
  await page.getByRole("button", { name: "Turn off here" }).click();
  await expect(page.getByRole("button", { name: "Enable notifications" })).toBeVisible();
  await expect(devices).toContainText("No devices get notifications yet.");
});

test("chooses what notifies you", async ({ page }) => {
  await page.goto("/inbox/notifications");
  const preferences = page.getByRole("region", { name: "What notifies you" });
  await preferences.getByLabel(/Scheduled prompts/).selectOption("digest");
  await preferences.getByRole("checkbox", { name: /Private previews/ }).check();
  await page.reload();
  await expect(preferences.getByLabel(/Scheduled prompts/)).toHaveValue("digest");
  await expect(preferences.getByRole("checkbox", { name: /Private previews/ })).toBeChecked();
  await preferences.getByLabel(/Scheduled prompts/).selectOption("immediate");
  await preferences.getByRole("checkbox", { name: /Private previews/ }).uncheck();
  await expect(preferences.getByLabel(/Scheduled prompts/)).toHaveValue("immediate");
});
