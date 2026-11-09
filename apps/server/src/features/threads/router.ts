import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { answerRequestEndpoint } from "./answer-request/endpoint.js";
import { createThreadEndpoint } from "./create-thread/endpoint.js";
import { getThreadEndpoint } from "./get-thread/endpoint.js";
import { interruptTurnEndpoint } from "./interrupt-turn/endpoint.js";
import { listThreadsEndpoint } from "./list-threads/endpoint.js";
import { sendMessageEndpoint } from "./send-message/endpoint.js";
import { streamThreadEventsEndpoint } from "./stream-thread-events/endpoint.js";
import { streamThreadsEndpoint } from "./stream-threads/endpoint.js";

export const threadsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/vaults/:vaultId/threads", listThreadsEndpoint),
  HttpRouter.add("POST", "/api/vaults/:vaultId/threads", createThreadEndpoint),
  HttpRouter.add("GET", "/api/threads/:threadId", getThreadEndpoint),
  HttpRouter.add("POST", "/api/threads/:threadId/messages", sendMessageEndpoint),
  HttpRouter.add("POST", "/api/threads/:threadId/interrupt", interruptTurnEndpoint),
  HttpRouter.add("POST", "/api/threads/:threadId/requests/:requestId", answerRequestEndpoint),
  HttpRouter.add("GET", "/events/threads/:threadId", streamThreadEventsEndpoint),
  HttpRouter.add("GET", "/events/vaults/:vaultId/threads", streamThreadsEndpoint),
);
