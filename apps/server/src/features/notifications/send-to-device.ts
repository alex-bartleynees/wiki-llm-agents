import type { PushPayload } from "@wiki-agents/contracts/notifications/model";
import { Effect } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { isExpired, type PushOptions, PushSender } from "./push-sender.js";
import { type DeviceWithTarget, NotificationsRepository } from "./repository.js";

/** What happened when one notification went to one device. */
export type DeviceResult =
  | { readonly _tag: "sent" }
  | { readonly _tag: "failed"; readonly error: string }
  | { readonly _tag: "expired" };

/**
 * Sends to one device and records the result on the device (and on the item's
 * delivery to it, when there is an item): a success resets its failures, a gone
 * subscription (404, 410) removes it, any other failure counts toward disabling it.
 */
export const sendToDevice = (entry: DeviceWithTarget, itemId: string | null, payload: PushPayload, options: PushOptions) =>
  Effect.gen(function* () {
    const sender = yield* PushSender;
    const repository = yield* NotificationsRepository;
    const clock = yield* WallClock;
    const result = yield* Effect.result(sender.send(entry.target, JSON.stringify(payload), options));
    const at = yield* clock.now;
    if (result._tag === "Success") {
      yield* repository.pushSent(entry.device.id, itemId, at);
      return { _tag: "sent" } as DeviceResult;
    }
    if (isExpired(result.failure)) {
      yield* Effect.logInfo(`push device ${entry.device.id} (${entry.device.name}): subscription expired, removed`);
      yield* repository.pushExpired(entry.device.id, itemId, at);
      return { _tag: "expired" } as DeviceResult;
    }
    yield* repository.pushFailed(entry.device.id, itemId, result.failure.message, at);
    return { _tag: "failed", error: result.failure.message } as DeviceResult;
  });
