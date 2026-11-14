import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { openEventStreamEndpoint } from "./open-event-stream/endpoint.js";
import { subscribeEndpoint } from "./subscribe/endpoint.js";
import { unsubscribeEndpoint } from "./unsubscribe/endpoint.js";

export const eventsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/events", openEventStreamEndpoint),
  HttpRouter.add("POST", "/api/events/:connectionId/subscriptions", subscribeEndpoint),
  HttpRouter.add("DELETE", "/api/events/:connectionId/subscriptions/:subscriptionId", unsubscribeEndpoint),
);
