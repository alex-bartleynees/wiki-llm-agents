import { Schema } from "effect";

/**
 * POST /api/changes/:changeId/undo: puts the file back as it was before the turn
 * (deletes it if the turn created it). Refused with 409 when the file has changed
 * since the turn; `GET /api/changes/:changeId` then has all three versions.
 */
export const UndoChangeRequest = Schema.Struct({ changeId: Schema.String });
export type UndoChangeRequest = typeof UndoChangeRequest.Type;
