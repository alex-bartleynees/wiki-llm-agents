import { expect, layer } from "@effect/vitest";
import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { AddDeviceResponse } from "@wiki-agents/contracts/notifications/add-device/response";
import { GetPreferencesResponse } from "@wiki-agents/contracts/notifications/get-preferences/response";
import { GetPushKeyResponse } from "@wiki-agents/contracts/notifications/get-push-key/response";
import { ListDevicesResponse } from "@wiki-agents/contracts/notifications/list-devices/response";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type PushPayload,
} from "@wiki-agents/contracts/notifications/model";
import { TestDeviceResponse } from "@wiki-agents/contracts/notifications/test-device/response";
import { Clock, Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestClock } from "effect/testing";
import { PushRejected, PushSender } from "../../src/features/notifications/push-sender.js";
import { zonedTime } from "../../src/shared/time/recurrence.js";
import { makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { AKL, createSchedule, del, inbox, ofKind, watchInbox } from "./infrastructure/schedules.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode, newThread, newVault, post, sendOk } from "./infrastructure/threads.js";

/**
 * A stand-in for the push services. Endpoints say how they behave:
 * `.../gone` answers 410, `.../down` 503, `.../flaky` fails its first two tries for
 * each notification, `.../offline` fails while `offline` is set; anything else takes it.
 */
const pushed: Array<{ endpoint: string; payload: PushPayload; urgency: string }> = [];
const flakyTries = new Map<string, number>();
let offline = false;
const FakePush = Layer.succeed(PushSender, {
  publicKey: "test-public-key",
  send: (target, payload, options) =>
    Effect.suspend(() => {
      const parsed = JSON.parse(payload) as PushPayload;
      if (target.endpoint.endsWith("/gone")) return Effect.fail(new PushRejected({ status: 410, message: "The push service answered 410" }));
      if (target.endpoint.endsWith("/down")) return Effect.fail(new PushRejected({ status: 503, message: "The push service answered 503" }));
      if (target.endpoint.endsWith("/offline") && offline) return Effect.fail(new PushRejected({ status: null, message: "Can't reach the push service: fetch failed" }));
      if (target.endpoint.endsWith("/flaky")) {
        const tries = (flakyTries.get(parsed.tag) ?? 0) + 1;
        flakyTries.set(parsed.tag, tries);
        if (tries <= 2) return Effect.fail(new PushRejected({ status: null, message: `Can't reach the push service (try ${tries})` }));
      }
      pushed.push({ endpoint: target.endpoint, payload: parsed, urgency: options.urgency });
      return Effect.void;
    }),
});

const provider = makeScriptedProvider();
provider.scripts.set("Edit the plan", ({ turnId }) =>
  Effect.succeed([{ _tag: "request.opened", turnId, requestId: `${turnId}-edit`, prompt: { _tag: "approval", title: "Edit Plan.md", detail: "add a line" } }]),
);

const put = (path: string, body: unknown) => HttpClient.execute(HttpClientRequest.put(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)));

const devices = HttpClient.get("/api/notifications/devices").pipe(
  Effect.flatMap(decode(ListDevicesResponse)),
  Effect.map((response) => response.devices),
);

const addDevice = (name: string, endpoint: string) =>
  post("/api/notifications/devices", { endpoint, keys: { p256dh: "p256dh-key", auth: "auth-secret" }, name }).pipe(
    Effect.flatMap(decode(AddDeviceResponse)),
    Effect.map((response) => response.device),
  );

const setPreferences = (change: Partial<NotificationPreferences>) =>
  put("/api/notifications/preferences", { preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...change } }).pipe(
    Effect.flatMap(decode(GetPreferencesResponse)),
  );

/** No devices, the default preferences and nothing pushed: each test starts here. */
const fresh = Effect.gen(function* () {
  for (const device of yield* devices) yield* del(`/api/notifications/devices/${device.id}`);
  yield* setPreferences({});
  pushed.length = 0;
});

const testDevice = (deviceId: string) => post(`/api/notifications/devices/${deviceId}/test`, {}).pipe(Effect.flatMap(decode(TestDeviceResponse)));

const pushDelivery = (item: InboxItem) => item.deliveries.find((delivery) => delivery.channel === "web-push");

/** The item once its Web Push delivery is no longer queued. */
const pushSettled = (itemId: string) => (item: InboxItem) => item.id === itemId && (pushDelivery(item)?.status ?? "queued") !== "queued";

/** Runs a reminder now and returns its item once Web Push has dealt with it. */
const remind = (text: string) =>
  Effect.gen(function* () {
    const schedule = yield* createSchedule({ kind: "reminder", text, recurrence: { _tag: "daily", time: "09:00" }, timezone: AKL });
    const watching = yield* watchInbox;
    const item = yield* watching.until(ofKind(schedule.id, "reminder"), post(`/api/schedules/${schedule.id}/run`, {}));
    return yield* watching.until(pushSettled(item.id), Effect.void);
  });

layer(makeTestApp({ providers: provider.registry, pushSender: FakePush }))("notifications", (it) => {
  it.effect("serves the key browsers subscribe with, and manages devices", () =>
    Effect.gen(function* () {
      yield* fresh;
      const key = yield* HttpClient.get("/api/notifications/push-key").pipe(Effect.flatMap(decode(GetPushKeyResponse)));
      expect(key.publicKey).toBe("test-public-key");

      const phone = yield* addDevice("Chrome on Android", "https://fcm.googleapis.com/fcm/send/abc");
      expect(phone).toMatchObject({ name: "Chrome on Android", service: "fcm.googleapis.com", failures: 0, disabled: false, lastSentAt: null });
      // Subscribing again with the same endpoint updates the device, not a second one.
      const again = yield* addDevice("Chrome on Pixel", "https://fcm.googleapis.com/fcm/send/abc");
      expect(again.id).toBe(phone.id);
      expect((yield* devices).map((device) => device.name)).toEqual(["Chrome on Pixel"]);

      expect((yield* post("/api/notifications/devices", { endpoint: "not a url", keys: { p256dh: "a", auth: "b" }, name: "x" })).status).toBe(400);
      expect((yield* del(`/api/notifications/devices/${phone.id}`)).status).toBe(200);
      expect((yield* del(`/api/notifications/devices/${phone.id}`)).status).toBe(404);
      expect(yield* devices).toEqual([]);
    }),
  );

  it.effect("notifies every device of a reminder, and opens its inbox item", () =>
    Effect.gen(function* () {
      yield* fresh;
      yield* addDevice("Phone", "https://push.test/phone");
      yield* addDevice("Laptop", "https://push.test/laptop");
      const item = yield* remind("Water the plants");

      expect(pushDelivery(item)).toMatchObject({ status: "sent", attempts: 1, detail: "Sent to Phone, Laptop." });
      expect(pushed).toEqual(
        ["https://push.test/phone", "https://push.test/laptop"].map((endpoint) => ({
          endpoint,
          payload: { title: item.title, body: "Water the plants", url: `/inbox?item=${item.id}`, tag: item.id },
          urgency: "high",
        })),
      );
      expect((yield* devices).every((device) => device.lastSentAt !== null)).toBe(true);
    }),
  );

  it.effect("notifies of an agent waiting for approval", () =>
    Effect.gen(function* () {
      yield* fresh;
      yield* addDevice("Phone", "https://push.test/phone");
      const thread = yield* newThread((yield* newVault).id, "scripted");
      const watching = yield* watchInbox;
      const waiting = yield* watching.until((item) => item.kind === "request" && item.source.threadId === thread.id, sendOk(thread.id, "Edit the plan"));
      const settled = yield* watching.until(pushSettled(waiting.id), Effect.void);
      expect(pushDelivery(settled)).toMatchObject({ status: "sent" });
      expect(pushed.map((push) => push.payload.title)).toEqual(["Approve: Edit Plan.md"]);
    }),
  );

  it.effect("says only what kind of item arrived when previews are private", () =>
    Effect.gen(function* () {
      yield* fresh;
      yield* setPreferences({ privatePreviews: true });
      yield* addDevice("Phone", "https://push.test/phone");
      const item = yield* remind("Call the bank about the card");
      expect(pushed.map((push) => push.payload)).toEqual([{ title: "wiki-agents", body: "A reminder is due.", url: `/inbox?item=${item.id}`, tag: item.id }]);
    }),
  );

  it.effect("removes a device whose subscription has expired", () =>
    Effect.gen(function* () {
      yield* fresh;
      yield* addDevice("Old phone", "https://push.test/gone");
      yield* addDevice("Phone", "https://push.test/phone");
      const item = yield* remind("Stretch");
      expect(pushDelivery(item)).toMatchObject({ status: "sent", detail: "Sent to Phone. Removed Old phone: subscription expired." });
      expect((yield* devices).map((device) => device.name)).toEqual(["Phone"]);
    }),
  );

  it.effect("retries only the devices that didn't get it, within bounds", () =>
    Effect.gen(function* () {
      yield* fresh;
      yield* addDevice("Phone", "https://push.test/phone");
      yield* addDevice("Tablet", "https://push.test/flaky");
      const schedule = yield* createSchedule({ kind: "reminder", text: "Take a break", recurrence: { _tag: "daily", time: "09:00" }, timezone: AKL });
      const watching = yield* watchInbox;
      const item = yield* watching.until(ofKind(schedule.id, "reminder"), post(`/api/schedules/${schedule.id}/run`, {}));
      const sent = yield* watching.until(
        (candidate) => candidate.id === item.id && pushDelivery(candidate)?.status === "sent",
        Effect.gen(function* () {
          for (let step = 0; step < 5; step++) yield* TestClock.adjust("10 seconds");
        }),
      );
      expect(pushDelivery(sent)).toMatchObject({ attempts: 3, detail: "Sent to Phone, Tablet.", lastError: null });
      expect(pushed.map((push) => push.endpoint)).toEqual(["https://push.test/phone", "https://push.test/flaky"]);
    }),
  );

  it.effect("keeps the inbox when muted, and holds routine items for the digest", () =>
    Effect.gen(function* () {
      yield* fresh;
      yield* addDevice("Phone", "https://push.test/phone");
      yield* setPreferences({ muted: true });
      const muted = yield* remind("Muted reminder");
      expect(pushDelivery(muted)).toMatchObject({ status: "skipped", detail: "Notifications are muted." });
      expect((yield* inbox).map((item) => item.id)).toContain(muted.id);

      yield* setPreferences({ routes: { ...DEFAULT_NOTIFICATION_PREFERENCES.routes, reminders: "digest" }, digestTime: "08:00" });
      const first = yield* remind("Read the paper");
      const second = yield* remind("Plan the week");
      expect(pushDelivery(first)).toMatchObject({ status: "skipped", detail: "Held for the 08:00 digest." });
      expect(pushed).toEqual([]);

      const now = yield* Clock.currentTimeMillis;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: AKL, year: "numeric", month: "2-digit", day: "2-digit" }).format(now + 86_400_000);
      const watching = yield* watchInbox;
      const digest = yield* watching.until(
        (item) => item.kind === "digest" && pushDelivery(item)?.status === "sent",
        TestClock.setTime(zonedTime(day, "08:00", AKL)!),
      );
      expect(digest).toMatchObject({ title: "Digest: 2 items", body: `• ${first.title}\n• ${second.title}` });
      expect(pushed.map((push) => push.payload.title)).toEqual(["Digest: 2 items"]);
      expect(second.id).not.toBe(first.id);
    }),
  );

  it.effect("sends a test notification, and disables a device after five failures in a row until one gets through", () =>
    Effect.gen(function* () {
      yield* fresh;
      const phone = yield* addDevice("Phone", "https://push.test/phone");
      expect(yield* testDevice(phone.id)).toMatchObject({ status: "sent", error: null, device: { id: phone.id, failures: 0 } });
      expect(pushed.map((push) => push.payload)).toEqual([{ title: "wiki-agents", body: "Test notification for Phone.", url: "/inbox/notifications", tag: "test" }]);

      const broken = yield* addDevice("Broken", "https://push.test/down");
      let last = yield* testDevice(broken.id);
      for (let attempt = 1; attempt < 5; attempt++) last = yield* testDevice(broken.id);
      expect(last).toMatchObject({ status: "failed", error: "The push service answered 503", device: { failures: 5, disabled: true } });
      // Subscribing again enables it.
      expect(yield* addDevice("Broken", "https://push.test/down")).toMatchObject({ failures: 0, disabled: false });

      // So does a test that gets through, once the push service can be reached again.
      const laptop = yield* addDevice("Laptop", "https://push.test/offline");
      offline = true;
      for (let attempt = 0; attempt < 5; attempt++) last = yield* testDevice(laptop.id);
      expect(last.device).toMatchObject({ failures: 5, disabled: true });
      offline = false;
      expect(yield* testDevice(laptop.id)).toMatchObject({ status: "sent", device: { failures: 0, disabled: false, lastError: null } });

      const gone = yield* addDevice("Gone", "https://push.test/gone");
      expect(yield* testDevice(gone.id)).toEqual({ status: "expired", error: null, device: null });
      expect((yield* post("/api/notifications/devices/nope/test", {})).status).toBe(404);
    }),
  );
});
