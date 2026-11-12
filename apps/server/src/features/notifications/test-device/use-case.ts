import type { TestDeviceResponse } from "@wiki-agents/contracts/notifications/test-device/response";
import { Effect, Option } from "effect";
import { DeviceNotFound } from "../errors.js";
import { NotificationsRepository } from "../repository.js";
import { APP_NAME } from "../routing.js";
import { sendToDevice } from "../send-to-device.js";

/**
 * Sends a test notification to one device now, outside the inbox, and says what the
 * push service made of it. Works on a disabled device too, so you can check it again.
 */
export const testDevice = (deviceId: string) =>
  Effect.gen(function* () {
    const repository = yield* NotificationsRepository;
    const entry = yield* repository.findDevice(deviceId);
    if (Option.isNone(entry)) return yield* new DeviceNotFound({ deviceId });
    const payload = { title: APP_NAME, body: `Test notification for ${entry.value.device.name}.`, url: "/inbox/notifications", tag: "test" };
    const result = yield* sendToDevice(entry.value, null, payload, { ttl: 60, urgency: "high" });
    const device = Option.getOrNull(Option.map(yield* repository.findDevice(deviceId), (found) => found.device));
    return {
      status: result._tag,
      error: result._tag === "failed" ? result.error : null,
      device,
    } satisfies TestDeviceResponse;
  });
