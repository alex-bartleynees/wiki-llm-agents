import { Schema } from "effect";

/**
 * GET /api/folders?path=… lists the folders inside an absolute path on the server's
 * machine (`~` allowed); without `path`, the home folder. For choosing folders in
 * the browser, which can't give the page a real path.
 */
export const ListFoldersRequest = Schema.Struct({ path: Schema.optionalKey(Schema.String) });
export type ListFoldersRequest = typeof ListFoldersRequest.Type;
