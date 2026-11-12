import type { PushDevice } from "@wiki-agents/contracts/notifications/model";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@wiki-agents/contracts/notifications/model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "#lib/api/client.ts";

/** The notifications store with real Svelte state; the API and the browser's push are stand-ins. */

const api = vi.hoisted(() => ({
  getPushKey: vi.fn(),
  listDevices: vi.fn(),
  addDevice: vi.fn(),
  removeDevice: vi.fn(),
  testDevice: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));
vi.mock("./api.ts", () => api);

const push = vi.hoisted(() => ({
  pushSupport: vi.fn(),
  permission: vi.fn(),
  subscribe: vi.fn(),
  currentSubscription: vi.fn(),
  unsubscribe: vi.fn(),
  deviceName: vi.fn(),
}));
vi.mock("./push-browser.ts", () => push);

const { notifications } = await import("./notifications.svelte.ts");

const device = (id: string, overrides: Partial<PushDevice> = {}): PushDevice => ({
  id,
  name: id,
  service: "fcm.googleapis.com",
  createdAt: 1,
  lastSentAt: null,
  lastError: null,
  failures: 0,
  disabled: false,
  ...overrides,
});

const subscription = { endpoint: "https://push.test/me", keys: { p256dh: "p", auth: "a" } };

beforeEach(() => {
  localStorage.clear();
  for (const mock of [...Object.values(api), ...Object.values(push)]) mock.mockReset();
  push.pushSupport.mockReturnValue("supported");
  push.permission.mockReturnValue("default");
  push.currentSubscription.mockResolvedValue(null);
  push.deviceName.mockReturnValue("Chrome on Linux");
  api.listDevices.mockResolvedValue({ devices: [] });
  api.getPreferences.mockResolvedValue({ preferences: DEFAULT_NOTIFICATION_PREFERENCES });
  notifications.devices = [];
  notifications.thisDeviceId = null;
  notifications.tests = {};
  notifications.error = null;
});

describe("notifications", () => {
  it("turns notifications on here: subscribes with the server's key and adds this device", async () => {
    await notifications.load();
    api.getPushKey.mockResolvedValue({ publicKey: "KEY" });
    push.subscribe.mockResolvedValue(subscription);
    push.permission.mockReturnValue("granted");
    api.addDevice.mockResolvedValue({ device: device("me", { name: "Chrome on Linux" }) });

    await notifications.enable();
    expect(push.subscribe).toHaveBeenCalledWith("KEY");
    expect(api.addDevice).toHaveBeenCalledWith({ ...subscription, name: "Chrome on Linux" });
    expect(notifications.thisDevice?.id).toBe("me");
    expect(notifications.permission).toBe("granted");
    expect(notifications.busy).toBe(false);

    // A reload still knows this browser is that device.
    api.listDevices.mockResolvedValue({ devices: [device("me")] });
    push.currentSubscription.mockResolvedValue(subscription);
    notifications.thisDeviceId = null;
    await notifications.load();
    expect(notifications.thisDeviceId).toBe("me");
  });

  it("says why when the browser blocks it", async () => {
    await notifications.load();
    api.getPushKey.mockResolvedValue({ publicKey: "KEY" });
    push.subscribe.mockRejectedValue(new Error("Notifications are blocked for this site"));
    push.permission.mockReturnValue("denied");
    await notifications.enable();
    expect(notifications.error).toBe("Notifications are blocked for this site");
    expect(notifications.permission).toBe("denied");
    expect(api.addDevice).not.toHaveBeenCalled();
  });

  it("doesn't take this browser for a device it no longer is", async () => {
    localStorage.setItem("wiki-agents:push-device", "me");
    api.listDevices.mockResolvedValue({ devices: [device("other")] });
    push.currentSubscription.mockResolvedValue(subscription);
    await notifications.load();
    expect(notifications.thisDeviceId).toBeNull();
  });

  it("turns them off here, even when the server already removed the device", async () => {
    notifications.devices = [device("me"), device("phone")];
    notifications.thisDeviceId = "me";
    api.removeDevice.mockRejectedValue(new ApiError(404, "Device not found"));
    await notifications.disable();
    expect(push.unsubscribe).toHaveBeenCalled();
    expect(notifications.devices.map((each) => each.id)).toEqual(["phone"]);
    expect(notifications.thisDeviceId).toBeNull();
    expect(notifications.error).toBeNull();
  });

  it("reports a test, and drops a device whose subscription expired", async () => {
    notifications.devices = [device("phone"), device("old")];
    api.testDevice.mockResolvedValueOnce({ status: "sent", error: null, device: device("phone", { lastSentAt: 5 }) });
    await notifications.test("phone");
    expect(notifications.tests["phone"]).toMatch(/^Sent/);
    expect(notifications.devices[0]?.lastSentAt).toBe(5);

    api.testDevice.mockResolvedValueOnce({ status: "expired", error: null, device: null });
    await notifications.test("old");
    expect(notifications.devices.map((each) => each.id)).toEqual(["phone"]);
  });

  it("keeps the old preferences when saving fails", async () => {
    await notifications.load();
    api.updatePreferences.mockRejectedValue(new Error("offline"));
    await notifications.savePreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, muted: true });
    expect(notifications.preferences?.muted).toBe(false);
    expect(notifications.error).toBe("offline");
  });
});
