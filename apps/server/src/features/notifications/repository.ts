import type { NotificationPreferences, PushDevice } from "@wiki-agents/contracts/notifications/model";
import { Context, type Effect, type Option } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";
import type { NewInboxItem } from "../inbox/repository.js";

/** Where a push goes: the subscription's endpoint and the keys its payload is encrypted for. */
export interface PushTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface DeviceWithTarget {
  readonly device: PushDevice;
  readonly target: PushTarget;
}

export interface NewDevice extends PushTarget {
  readonly name: string;
}

export interface VapidKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** An item held for the digest, as it is now. */
export interface HeldItem {
  readonly kind: string;
  readonly title: string;
}

/** Devices failing this many times in a row are disabled until they subscribe again. */
export const MAX_DEVICE_FAILURES = 5;

/**
 * Push devices, each inbox item's delivery to each device, the digest queue,
 * preferences and VAPID keys.
 */
export interface NotificationsRepositoryService {
  readonly preferences: Effect.Effect<NotificationPreferences, DbError>;
  readonly savePreferences: (preferences: NotificationPreferences) => Effect.Effect<void, DbError>;
  /** The stored key pair, made with `make` the first time. */
  readonly vapidKeys: (make: () => VapidKeyPair) => Effect.Effect<VapidKeyPair, DbError>;

  /** Every device, newest first. */
  readonly devices: Effect.Effect<ReadonlyArray<PushDevice>, DbError>;
  /** The devices notifications go to (not disabled). */
  readonly activeDevices: Effect.Effect<ReadonlyArray<DeviceWithTarget>, DbError>;
  readonly findDevice: (deviceId: string) => Effect.Effect<Option.Option<DeviceWithTarget>, DbError>;
  /** Adds the device, or updates the one with the same endpoint and enables it again. */
  readonly putDevice: (device: NewDevice, at: number) => Effect.Effect<PushDevice, DbError>;
  /** False when there was no such device. */
  readonly removeDevice: (deviceId: string) => Effect.Effect<boolean, DbError>;

  /** The push service took it: failures reset; recorded for the item when there is one. */
  readonly pushSent: (deviceId: string, itemId: string | null, at: number) => Effect.Effect<void, DbError>;
  /** One more failure in a row (disabled at the limit); the device after it. */
  readonly pushFailed: (deviceId: string, itemId: string | null, error: string, at: number) => Effect.Effect<Option.Option<PushDevice>, DbError>;
  /** The subscription is gone: the device is removed, and the item records why. */
  readonly pushExpired: (deviceId: string, itemId: string | null, at: number) => Effect.Effect<void, DbError>;
  /** Devices that already got the item since it was last queued. */
  readonly sentTo: (itemId: string) => Effect.Effect<ReadonlySet<string>, DbError>;
  /** Forgets the item's deliveries to devices: it was queued again, so it goes to every device again. */
  readonly resetItem: (itemId: string) => Effect.Effect<void, DbError>;

  /** Holds the item for the next digest (once). */
  readonly holdForDigest: (itemId: string, at: number) => Effect.Effect<void, DbError>;
  /** When the oldest held item was held; null when none is. */
  readonly oldestHeldAt: Effect.Effect<number | null, DbError>;
  /**
   * Takes the items held before `before` and, if any are still open, adds the digest
   * item made by `digest` (queued on `channels`), in one transaction, so a digest
   * never lists an item twice. Returns the digest's id.
   */
  readonly takeDigest: (
    before: number,
    digest: (items: ReadonlyArray<HeldItem>) => NewInboxItem,
    channels: ReadonlyArray<string>,
    at: number,
  ) => Effect.Effect<Option.Option<string>, DbError>;
}

export class NotificationsRepository extends Context.Service<NotificationsRepository, NotificationsRepositoryService>()("NotificationsRepository") {}
