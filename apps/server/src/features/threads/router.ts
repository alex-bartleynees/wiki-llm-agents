import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { answerRequestEndpoint } from "./answer-request/endpoint.js";
import { createThreadEndpoint } from "./create-thread/endpoint.js";
import { getThreadEndpoint } from "./get-thread/endpoint.js";
import { interruptTurnEndpoint } from "./interrupt-turn/endpoint.js";
import { listModelsEndpoint } from "./list-models/endpoint.js";
import { listThreadsEndpoint } from "./list-threads/endpoint.js";
import { markDoneEndpoint } from "./mark-done/endpoint.js";
import { reopenThreadEndpoint } from "./reopen-thread/endpoint.js";
import { sendMessageEndpoint } from "./send-message/endpoint.js";
import { setAgentEndpoint } from "./set-agent/endpoint.js";
import { setModelEndpoint } from "./set-model/endpoint.js";
import { streamThreadEventsEndpoint } from "./stream-thread-events/endpoint.js";
import { streamThreadsEndpoint } from "./stream-threads/endpoint.js";

import { listNoteContextEndpoint } from "./list-note-context/endpoint.js";

export const threadsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/vaults/:vaultId/thread-notes", listNoteContextEndpoint),
  HttpRouter.add("GET", "/api/vaults/:vaultId/threads", listThreadsEndpoint),
  HttpRouter.add("POST", "/api/vaults/:vaultId/threads", createThreadEndpoint),
  HttpRouter.add("GET", "/api/threads/:threadId", getThreadEndpoint),
  HttpRouter.add("POST", "/api/threads/:threadId/messages", sendMessageEndpoint),
  HttpRouter.add("POST", "/api/threads/:threadId/interrupt", interruptTurnEndpoint),
  HttpRouter.add("POST", "/api/threads/:threadId/requests/:requestId", answerRequestEndpoint),
  HttpRouter.add("GET", "/api/threads/:threadId/models", listModelsEndpoint),
  HttpRouter.add("PUT", "/api/threads/:threadId/model", setModelEndpoint),
  HttpRouter.add("PUT", "/api/threads/:threadId/agent", setAgentEndpoint),
  HttpRouter.add("POST", "/api/threads/:threadId/done", markDoneEndpoint),
  HttpRouter.add("POST", "/api/threads/:threadId/reopen", reopenThreadEndpoint),
  HttpRouter.add("GET", "/events/threads/:threadId", streamThreadEventsEndpoint),
  HttpRouter.add("GET", "/events/vaults/:vaultId/threads", streamThreadsEndpoint),
);
