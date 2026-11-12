import type { NotificationPreferences, PushDevice } from "@wiki-agents/contracts/notifications/model";
import { ApiError, errorMessage } from "#lib/api/client.ts";
import { addDevice, getPreferences, getPushKey, listDevices, removeDevice, testDevice, updatePreferences } from "./api.ts";
import * as push from "./push-browser.ts";

/** Which device this browser is, once it has turned notifications on. */
const THIS_DEVICE_KEY = "wiki-agents:push-device";

const readThisDevice = () => {
  try {
    return localStorage.getItem(THIS_DEVICE_KEY);
  } catch {
    return null;
  }
};

const writeThisDevice = (deviceId: string | null) => {
  try {
    if (deviceId === null) localStorage.removeItem(THIS_DEVICE_KEY);
    else localStorage.setItem(THIS_DEVICE_KEY, deviceId);
  } catch {
    // Private mode: this browser just won't be marked as "this device".
  }
};

/**
 * Notifications on your devices: this browser's subscription, every device that gets
 * them, and the preferences. Loaded when the notifications page opens.
 */
class NotificationsStore {
  status = $state<"loading" | "loaded" | "failed">("loading");
  error = $state<string | null>(null);
  support = $state<push.PushSupport>("unsupported");
  permission = $state<NotificationPermission>("default");
  devices = $state<ReadonlyArray<PushDevice>>([]);
  preferences = $state<NotificationPreferences | null>(null);
  /** This browser's device, when it gets notifications. */
  thisDeviceId = $state<string | null>(null);
  /** Turning notifications on or off here. */
  busy = $state(false);
  /** The latest test result for each device. */
  tests = $state<Readonly<Record<string, string>>>({});

  get thisDevice() {
    return this.devices.find((device) => device.id === this.thisDeviceId) ?? null;
  }

  async load() {
    this.support = push.pushSupport();
    this.permission = push.permission();
    try {
      const [devices, preferences] = await Promise.all([listDevices(), getPreferences()]);
      this.devices = devices.devices;
      this.preferences = preferences.preferences;
      const stored = readThisDevice();
      const subscribed = this.support === "supported" ? await push.currentSubscription().catch(() => null) : null;
      this.thisDeviceId = stored !== null && subscribed !== null && this.devices.some((device) => device.id === stored) ? stored : null;
      this.status = "loaded";
      this.error = null;
    } catch (error) {
      this.status = "failed";
      this.error = errorMessage(error, "Could not load notifications");
    }
  }

  /** Asks for permission, subscribes this browser, and adds it as a device. */
  async enable() {
    await this.#busy(async () => {
      const { publicKey } = await getPushKey();
      try {
        const subscription = await push.subscribe(publicKey);
        const { device } = await addDevice({ ...subscription, name: push.deviceName() });
        this.#upsert(device);
        this.thisDeviceId = device.id;
        writeThisDevice(device.id);
      } finally {
        this.permission = push.permission();
      }
    }, "Could not turn on notifications");
  }

  /** Stops notifications to this browser. */
  async disable() {
    const deviceId = this.thisDeviceId;
    await this.#busy(async () => {
      await push.unsubscribe();
      if (deviceId !== null) await this.#forget(deviceId);
    }, "Could not turn off notifications");
  }

  async remove(deviceId: string) {
    await this.#busy(async () => {
      if (deviceId === this.thisDeviceId) await push.unsubscribe();
      await this.#forget(deviceId);
    }, "Could not remove the device");
  }

  async test(deviceId: string) {
    try {
      const result = await testDevice(deviceId);
      const message =
        result.status === "sent"
          ? "Sent. It should appear in a few seconds."
          : result.status === "expired"
            ? "Its subscription has expired, so it was removed. Turn notifications on there again."
            : `Not sent: ${result.error}`;
      this.tests = { ...this.tests, [deviceId]: message };
      if (result.device === null) this.#drop(deviceId);
      else this.#upsert(result.device);
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error, "Could not send a test notification");
    }
  }

  async savePreferences(preferences: NotificationPreferences) {
    const before = this.preferences;
    this.preferences = preferences;
    try {
      this.preferences = (await updatePreferences(preferences)).preferences;
      this.error = null;
    } catch (error) {
      this.preferences = before;
      this.error = errorMessage(error, "Could not save the preferences");
    }
  }

  async #forget(deviceId: string) {
    try {
      await removeDevice(deviceId);
    } catch (error) {
      // Already gone (removed elsewhere, or expired): what we wanted.
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
    this.#drop(deviceId);
  }

  #drop(deviceId: string) {
    this.devices = this.devices.filter((device) => device.id !== deviceId);
    if (deviceId === this.thisDeviceId) {
      this.thisDeviceId = null;
      writeThisDevice(null);
    }
  }

  #upsert(device: PushDevice) {
    this.devices = this.devices.some((existing) => existing.id === device.id)
      ? this.devices.map((existing) => (existing.id === device.id ? device : existing))
      : [device, ...this.devices];
  }

  async #busy(action: () => Promise<void>, fallback: string) {
    this.busy = true;
    try {
      await action();
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error, fallback);
    } finally {
      this.busy = false;
    }
  }
}

export const notifications = new NotificationsStore();
