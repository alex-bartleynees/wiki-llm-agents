/**
 * Records `codex app-server`'s raw JSON-RPC traffic, unfiltered, for protocol
 * discovery of Codex's subagents (`collabAgentToolCall`, `subAgentActivity`, the child
 * threads' own notifications and requests). Speaks JSON-RPC directly, with the thread
 * set up as the adapter sets it up (`on-request` approvals, read-only sandbox), in a
 * temp copy of the fixture vault; nothing outside the temp folder is touched, though
 * the threads are saved in Codex's own history.
 *
 *   npm run probe:codex -w @wiki-agents/server -- --out trace.jsonl \
 *     [--model gpt-5.6-luna] [--quiet 60] [--reply accept|decline] \
 *     [--interrupt-after-agents n] [--stop-agents] [--stop-agents-when-idle] \
 *     [--send-on-report] [--list] "prompt" ["follow-up"...]
 *
 * Each prompt is sent once the parent thread's turn completes. The probe ends after
 * `--quiet` seconds without any message once the last prompt has been sent, so late
 * child output after the parent's turn is recorded too. Approvals are answered with
 * `--reply` (default `accept`), questions with "Sencha". `--interrupt-after-agents n`
 * interrupts the parent's turn once the n-th child thread starts; with `--stop-agents`
 * each running child turn is interrupted too. `--stop-agents-when-idle` interrupts each
 * running child turn when the parent's first turn completes. `--send-on-report` sends
 * each follow-up the moment a child's turn completes instead of at the parent's;
 * `--follow-up-delay s` sends each follow-up that many seconds after the parent's turn.
 * `--list` reads `thread/loaded/list`, `thread/list` (subagent sources) and
 * `thread/read` of each child before closing.
 */
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CodexLauncherLive, initialize, makeRpc, type Incoming } from "../src/features/providers/codex/app-server.js";
import { HOME, VAULT, VAULT_FILES } from "../tests/fixtures/codex/fixture.js";

const { values, positionals } = parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", default: "gpt-5.6-luna" },
    quiet: { type: "string", default: "60" },
    reply: { type: "string", default: "accept" },
    "interrupt-after-agents": { type: "string" },
    "stop-agents": { type: "boolean", default: false },
    "stop-agents-when-idle": { type: "boolean", default: false },
    "send-on-report": { type: "boolean", default: false },
    "follow-up-delay": { type: "string", default: "0" },
    list: { type: "boolean", default: false },
  },
  allowPositionals: true,
});
if (values.out === undefined || positionals.length === 0) throw new Error('usage: --out trace.jsonl [--model gpt-5.6-luna] "prompt" ["follow-up"...]');
const out = resolve(values.out);
writeFileSync(out, "");
const quietMs = Number(values.quiet) * 1000;

const root = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-probe-")));
for (const [path, content] of Object.entries(VAULT_FILES)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
const started = Date.now();
const log = (entry: Record<string, unknown>) =>
  appendFileSync(out, `${JSON.stringify({ t: Date.now() - started, ...entry }).replaceAll(root, VAULT).replaceAll(homedir(), HOME)}\n`);

let lastMessage = Date.now();
let parentId: string | undefined;
/** Child thread ids, in the order they started. */
const children: Array<string> = [];
/** The running turn of each thread (parent and children). */
const activeTurns = new Map<string, string>();
let parentTurnsCompleted = 0;
/** A follow-up is waiting out `--follow-up-delay`. */
let followUpWaiting = false;

const binary = process.env.WIKI_AGENTS_CODEX ?? "codex";
const proc = CodexLauncherLive.launch({ binary, cwd: root, env: {} });
const wrapped = {
  ...proc,
  send: (message: Parameters<typeof proc.send>[0]) => {
    log({ sent: message });
    proc.send(message);
  },
};

const interruptTurn = async (threadId: string) => {
  const turnId = activeTurns.get(threadId);
  if (turnId === undefined) return log({ note: "no running turn to interrupt", threadId });
  await rpc.request("turn/interrupt", { threadId, turnId }).then(
    (result) => log({ interruptDone: { threadId, result } }),
    (error: unknown) => log({ interruptFailed: { threadId, error: String(error) } }),
  );
};
const stopAgents = async () => {
  for (const child of children) if (activeTurns.has(child)) await interruptTurn(child);
};

const pending = [...positionals];
const send = () => {
  const text = pending.shift();
  if (text === undefined || parentId === undefined) return;
  void rpc.request("turn/start", { threadId: parentId, input: [{ type: "text", text, text_elements: [] }], model: values.model }).catch((error: unknown) => log({ turnStartFailed: String(error) }));
};

const onRequest = (request: Extract<Incoming, { readonly _tag: "request" }>) => {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return rpc.respond(request.id, { decision: values.reply });
    case "item/permissions/requestApproval":
      return rpc.respond(request.id, { permissions: {}, scope: "turn" });
    case "item/tool/requestUserInput": {
      const questions = (request.params as { readonly questions: ReadonlyArray<{ readonly id: string }> }).questions;
      return rpc.respond(request.id, { answers: Object.fromEntries(questions.map((question) => [question.id, { answers: ["Sencha"] }])) });
    }
    case "mcpServer/elicitation/request":
      return rpc.respond(request.id, { action: "accept", content: {}, _meta: null });
    default:
      return rpc.respondError(request.id, `the probe doesn't handle ${request.method}`);
  }
};

const onNotification = async (method: string, params: Record<string, unknown>) => {
  // Codex 0.169 sends no `thread/started` for a child: the spawn call names it.
  const item = params.item as { readonly type?: string; readonly tool?: string; readonly receiverThreadIds?: ReadonlyArray<string> } | undefined;
  if (method === "item/completed" && item?.type === "collabAgentToolCall" && item.tool === "spawnAgent") {
    for (const child of item.receiverThreadIds ?? []) {
      if (children.includes(child)) continue;
      children.push(child);
      if (children.length === Number(values["interrupt-after-agents"])) {
        if (parentId !== undefined) await interruptTurn(parentId);
        if (values["stop-agents"] === true) setTimeout(() => void stopAgents(), 2000);
      }
    }
  }
  if (method === "turn/started") activeTurns.set(params.threadId as string, (params.turn as { readonly id: string }).id);
  if (method === "turn/completed") {
    const threadId = params.threadId as string;
    activeTurns.delete(threadId);
    if (threadId === parentId) {
      parentTurnsCompleted++;
      if (parentTurnsCompleted === 1 && values["stop-agents-when-idle"] === true) await stopAgents();
      if (values["send-on-report"] !== true) {
        const delay = Number(values["follow-up-delay"]) * 1000;
        if (delay > 0 && pending.length > 0) {
          followUpWaiting = true;
          setTimeout(() => {
            followUpWaiting = false;
            send();
          }, delay);
        } else send();
      }
    } else if (values["send-on-report"] === true) {
      send();
    }
  }
};

const rpc = makeRpc(
  wrapped,
  (message) => {
    lastMessage = Date.now();
    log({ received: message });
    if (message._tag === "request") onRequest(message);
    else void onNotification(message.method, (message.params ?? {}) as Record<string, unknown>);
  },
  (reason) => log({ note: "codex exited", reason }),
);

await initialize(rpc);
const opened = await rpc.request<{ readonly thread: { readonly id: string } }>("thread/start", {
  cwd: root,
  model: values.model,
  approvalPolicy: "on-request",
  sandbox: "read-only",
  config: {},
  developerInstructions: null,
});
parentId = opened.thread.id;
log({ note: "parent thread", parentId });
send();

while (!(pending.length === 0 && !followUpWaiting && Date.now() - lastMessage > quietMs)) {
  await new Promise((done) => setTimeout(done, 1000));
}
if (values.list === true) {
  const read = (method: string, params: unknown) =>
    rpc.request(method, params).then(
      (result) => log({ listed: { method, params, result } }),
      (error: unknown) => log({ listFailed: { method, params, error: String(error) } }),
    );
  await read("thread/loaded/list", {});
  await read("thread/list", { sourceKinds: ["subAgentThreadSpawn", "subAgent"], limit: 20 });
  for (const child of children) await read("thread/read", { threadId: child });
}
log({ note: "quiet; closing", children, running: [...activeTurns.entries()] });
rpc.kill();
console.log(`trace written to ${out}`);
process.exit(0);
