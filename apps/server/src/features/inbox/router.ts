import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { dismissItemEndpoint } from "./dismiss-item/endpoint.js";
import { listInboxEndpoint } from "./list-inbox/endpoint.js";
import { markItemDoneEndpoint } from "./mark-item-done/endpoint.js";
import { markReadEndpoint } from "./mark-read/endpoint.js";
import { snoozeItemEndpoint } from "./snooze-item/endpoint.js";
import { streamInboxEndpoint } from "./stream-inbox/endpoint.js";

export const inboxRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/inbox", listInboxEndpoint),
  HttpRouter.add("POST", "/api/inbox/read", markReadEndpoint),
  HttpRouter.add("POST", "/api/inbox/:itemId/snooze", snoozeItemEndpoint),
  HttpRouter.add("POST", "/api/inbox/:itemId/dismiss", dismissItemEndpoint),
  HttpRouter.add("POST", "/api/inbox/:itemId/done", markItemDoneEndpoint),
  HttpRouter.add("GET", "/events/inbox", streamInboxEndpoint),
);
