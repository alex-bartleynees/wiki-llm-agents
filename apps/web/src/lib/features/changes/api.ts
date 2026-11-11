import { GetChangeResponse } from "@wiki-agents/contracts/changes/get-change/response";
import { UndoChangeRequest } from "@wiki-agents/contracts/changes/undo-change/request";
import { UndoChangeResponse } from "@wiki-agents/contracts/changes/undo-change/response";
import { getJson, postJson } from "#lib/api/client.ts";

const changePath = (changeId: string) => `/api/changes/${encodeURIComponent(changeId)}`;

/** One change in full (before, after, now), for the whole diff or the three-way view. */
export const getChange = (changeId: string, signal?: AbortSignal) => getJson(changePath(changeId), GetChangeResponse, signal);

/** Undoes a change; 409 when the file changed since the turn, or it was undone already. */
export const undoChange = (changeId: string) => postJson(`${changePath(changeId)}/undo`, UndoChangeRequest, { changeId }, UndoChangeResponse);
