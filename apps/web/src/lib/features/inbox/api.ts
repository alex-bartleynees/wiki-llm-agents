import { DismissItemResponse } from "@wiki-agents/contracts/inbox/dismiss-item/response";
import { ListInboxResponse } from "@wiki-agents/contracts/inbox/list-inbox/response";
import { MarkItemDoneResponse } from "@wiki-agents/contracts/inbox/mark-item-done/response";
import { MarkReadRequest } from "@wiki-agents/contracts/inbox/mark-read/request";
import { MarkReadResponse } from "@wiki-agents/contracts/inbox/mark-read/response";
import { SnoozeItemRequest } from "@wiki-agents/contracts/inbox/snooze-item/request";
import { SnoozeItemResponse } from "@wiki-agents/contracts/inbox/snooze-item/response";
import { Schema } from "effect";
import { getJson, postJson } from "#lib/api/client.ts";

const itemPath = (itemId: string) => `/api/inbox/${encodeURIComponent(itemId)}`;
const NoBody = Schema.Struct({});

export const INBOX_EVENTS_PATH = "/events/inbox";

export const listInbox = (signal?: AbortSignal) => getJson("/api/inbox", ListInboxResponse, signal);
export const markRead = (itemIds: ReadonlyArray<string>) => postJson("/api/inbox/read", MarkReadRequest, { itemIds }, MarkReadResponse);
export const snoozeItem = (itemId: string, until: number) => postJson(`${itemPath(itemId)}/snooze`, SnoozeItemRequest, { until }, SnoozeItemResponse);
export const dismissItem = (itemId: string) => postJson(`${itemPath(itemId)}/dismiss`, NoBody, {}, DismissItemResponse);
export const markItemDone = (itemId: string) => postJson(`${itemPath(itemId)}/done`, NoBody, {}, MarkItemDoneResponse);
