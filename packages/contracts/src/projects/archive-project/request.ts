import { Schema } from "effect";

/**
 * POST /api/projects/:projectId/archive: the project leaves the project switchers and
 * takes no new threads; its threads and changed-file baseline are kept. Archiving an
 * archived project changes nothing.
 */
export const ArchiveProjectRequest = Schema.Struct({ projectId: Schema.String });
export type ArchiveProjectRequest = typeof ArchiveProjectRequest.Type;
