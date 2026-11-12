import { AddDeviceRequest } from "@wiki-agents/contracts/notifications/add-device/request";
import { AddDeviceResponse } from "@wiki-agents/contracts/notifications/add-device/response";
import { GetPreferencesResponse } from "@wiki-agents/contracts/notifications/get-preferences/response";
import { GetPushKeyResponse } from "@wiki-agents/contracts/notifications/get-push-key/response";
import { ListDevicesResponse } from "@wiki-agents/contracts/notifications/list-devices/response";
import type { NotificationPreferences } from "@wiki-agents/contracts/notifications/model";
import { RemoveDeviceResponse } from "@wiki-agents/contracts/notifications/remove-device/response";
import { TestDeviceResponse } from "@wiki-agents/contracts/notifications/test-device/response";
import { UpdatePreferencesRequest } from "@wiki-agents/contracts/notifications/update-preferences/request";
import { UpdatePreferencesResponse } from "@wiki-agents/contracts/notifications/update-preferences/response";
import { Schema } from "effect";
import { deleteJson, getJson, postJson, putJson } from "#lib/api/client.ts";

const devicePath = (deviceId: string) => `/api/notifications/devices/${encodeURIComponent(deviceId)}`;

export const getPushKey = () => getJson("/api/notifications/push-key", GetPushKeyResponse);
export const listDevices = () => getJson("/api/notifications/devices", ListDevicesResponse);
export const addDevice = (device: AddDeviceRequest) => postJson("/api/notifications/devices", AddDeviceRequest, device, AddDeviceResponse);
export const removeDevice = (deviceId: string) => deleteJson(devicePath(deviceId), RemoveDeviceResponse);
export const testDevice = (deviceId: string) => postJson(`${devicePath(deviceId)}/test`, Schema.Struct({}), {}, TestDeviceResponse);
export const getPreferences = () => getJson("/api/notifications/preferences", GetPreferencesResponse);
export const updatePreferences = (preferences: NotificationPreferences) =>
  putJson("/api/notifications/preferences", UpdatePreferencesRequest, { preferences }, UpdatePreferencesResponse);
