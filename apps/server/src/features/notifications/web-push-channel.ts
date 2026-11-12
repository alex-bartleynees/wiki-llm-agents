import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { Effect } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { type DeliveryChannel, DeliveryFailed } from "../inbox/delivery.js";
import { DigestSignal } from "./digest.js";
import { type PushOptions, PushSender } from "./push-sender.js";
import { NotificationsRepository } from "./repository.js";
import { decide, payloadFor } from "./routing.js";
import { sendToDevice } from "./send-to-device.js";

export const WEB_PUSH_CHANNEL = "web-push";

/** A notification waits a day for a device that is off; after that it's old news (the inbox has it). */
const TTL_SECONDS = 24 * 60 * 60;

/** Devices that get a delivery at once; more wait for these. */
const CONCURRENCY = 4;

const names = (list: ReadonlyArray<string>) => list.join(", ");

/**
 * Inbox items as notifications on every device, as the preferences say: now, held for
 * the digest, or not at all. A delivery that fails on some devices fails as a whole,
 * so the delivery worker retries it, but each try only goes to the devices that
 * haven't got it yet.
 */
export const makeWebPushChannel = Effect.gen(function* () {
  const context = yield* Effect.context<NotificationsRepository | WallClock | PushSender>();
  const repository = yield* NotificationsRepository;
  const clock = yield* WallClock;
  const signal = yield* DigestSignal;

  const deliver = (item: InboxItem, attempts: number) =>
    Effect.gen(function* () {
      const preferences = yield* repository.preferences;
      const decision = decide(item, preferences);
      if (decision._tag === "skip") return { status: "skipped" as const, detail: decision.reason };
      if (decision._tag === "hold") {
        yield* repository.holdForDigest(item.id, yield* clock.now);
        yield* signal.wake;
        return { status: "skipped" as const, detail: `Held for the ${preferences.digestTime} digest.` };
      }
      const devices = yield* repository.activeDevices;
      if (devices.length === 0) return { status: "skipped" as const, detail: "No devices get notifications." };
      if (attempts === 0) yield* repository.resetItem(item.id);
      const already = yield* repository.sentTo(item.id);
      const options: PushOptions = { ttl: TTL_SECONDS, urgency: decision.urgent ? "high" : "normal" };
      const payload = payloadFor(item, preferences);
      const pending = devices.filter((entry) => !already.has(entry.device.id));
      const results = yield* Effect.forEach(
        pending,
        (entry) => Effect.map(sendToDevice(entry, item.id, payload, options), (result) => ({ name: entry.device.name, result })),
        { concurrency: CONCURRENCY },
      );
      const failed = results.flatMap(({ name, result }) => (result._tag === "failed" ? [`${name}: ${result.error}`] : []));
      if (failed.length > 0) return yield* new DeliveryFailed({ message: failed.join("; ") });
      const sentNames = devices.filter((entry) => already.has(entry.device.id)).map((entry) => entry.device.name);
      sentNames.push(...results.flatMap(({ name, result }) => (result._tag === "sent" ? [name] : [])));
      const expired = results.flatMap(({ name, result }) => (result._tag === "expired" ? [name] : []));
      const removed = expired.length === 0 ? "" : ` Removed ${names(expired)}: subscription expired.`;
      if (sentNames.length === 0) return { status: "skipped" as const, detail: `No device got it.${removed}` };
      return { status: "sent" as const, detail: `Sent to ${names(sentNames)}.${removed}` };
    }).pipe(
      Effect.catchTag("DbError", (error) => Effect.fail(new DeliveryFailed({ message: `Database error: ${String(error.cause)}` }))),
      Effect.provideContext(context),
    );

  return { id: WEB_PUSH_CHANNEL, deliver } satisfies DeliveryChannel;
});
