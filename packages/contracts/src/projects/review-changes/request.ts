import { Schema } from "effect";

/**
 * POST /api/projects/:projectId/changes/review: marks the current files as reviewed,
 * so the changed-file list starts again from now (after review in lazygit/git). Only
 * directories outside git list changes from it; those in git compare with `HEAD`.
 */
export const ReviewChangesRequest = Schema.Struct({ projectId: Schema.String });
export type ReviewChangesRequest = typeof ReviewChangesRequest.Type;
