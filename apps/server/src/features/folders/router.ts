import { HttpRouter } from "effect/http";
import { listFoldersEndpoint } from "./list-folders/endpoint.js";

/** Folders on this machine, for choosing project and vault folders in the browser. */
export const foldersRouter = HttpRouter.add("GET", "/api/folders", listFoldersEndpoint);
