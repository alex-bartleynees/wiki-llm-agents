import type { AgentInput, Autonomy } from "@wiki-agents/contracts/agents/model";
import type { BrowserSignIn } from "@wiki-agents/contracts/projects/model";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ThreadActors } from "../../../src/features/threads/thread-actors.js";
import { mcpSession, tokenFor } from "./mcp.js";
import { decode, post, setAgent, watch } from "./threads.js";

/** Registers a project working in `directory`, on the first registered vault. */
export const registerProject = (name: string, directory: string) =>
  post("/api/projects", { name, workingDirectories: [directory] }).pipe(Effect.flatMap(decode(RegisterProjectResponse)), Effect.map((result) => result.project));

export const signInsPath = (projectId: string) => `/api/projects/${projectId}/browser-sign-ins`;

export const saveSignIns = (projectId: string, signIns: ReadonlyArray<BrowserSignIn>) =>
  HttpClient.execute(HttpClientRequest.put(signInsPath(projectId)).pipe(HttpClientRequest.bodyJsonUnsafe({ signIns })));

export const setSecret = (name: string, value: string) =>
  HttpClient.execute(HttpClientRequest.put(`/api/secrets/${name}`).pipe(HttpClientRequest.bodyJsonUnsafe({ value, expiresAt: null }))).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
  );

/** Writes agent `id` with the browser and `autonomy` on top of reading freely. */
const agentWith = (id: string, autonomy: Partial<Autonomy>) =>
  Effect.gen(function* () {
    const agent: AgentInput = {
      name: id, description: "", provider: null, model: null, sources: [], mcp: ["playwright"],
      autonomy: { read: "allow", create: "ask", edit: "ask", commands: "deny", web: "deny", tools: "ask", subagents: "ask", ...autonomy },
      instructions: "Use the browser.",
    };
    yield* HttpClient.execute(HttpClientRequest.put(`/api/agents/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ agent, baseHash: null }))).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
  });

export const isQuestion = (event: ThreadEvent) => event._tag === "request.opened" && event.prompt._tag === "question";
export const isToolRequest = (event: ThreadEvent) => event._tag === "request.opened" && event.requestId.startsWith("mcp-tool:");

/** A thread in `projectId` whose agent has the browser, with a turn running (the replay waits on a question), and an MCP session for it. */
export const browserThreadInTurn = (projectId: string, vaultId: string, autonomy: Partial<Autonomy>) =>
  Effect.gen(function* () {
    const { thread } = yield* post(`/api/vaults/${vaultId}/threads`, { projectId }).pipe(Effect.flatMap(decode(CreateThreadResponse)));
    const agentId = `browser-${thread.id.slice(0, 8).toLowerCase()}`;
    yield* agentWith(agentId, autonomy);
    yield* setAgent(thread.id, agentId);
    const events = yield* watch(thread.id);
    yield* (yield* ThreadActors).sendMessage(thread.id, "Ask me a question");
    yield* events.until(isQuestion);
    const mcp = yield* mcpSession((yield* tokenFor(thread.id, vaultId)).token);
    return { thread, events, mcp };
  });
