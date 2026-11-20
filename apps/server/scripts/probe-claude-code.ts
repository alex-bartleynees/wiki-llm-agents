/**
 * Records Claude Code's raw SDK messages, unfiltered, for protocol discovery: every
 * message type (task lifecycle, subagent messages, held results), every `PreToolUse`
 * hook call and every `canUseTool` call with the subagent it came from. Runs the real
 * SDK with streaming input, as the adapter does, in a temp copy of the fixture vault
 * with none of your settings (`settingSources: []`); nothing outside the temp folder is
 * touched, though the session is saved in Claude Code's own history.
 *
 *   npm run probe:claude-code -w @wiki-agents/server -- --out trace.jsonl \
 *     [--model haiku] [--quiet 60] [--reply allow|deny] [--per-task-stop] [--summaries] \
 *     [--interrupt-after-tasks n] [--stop-tasks] [--interrupt-when-idle] [--stop-tasks-when-idle] \
 *     "prompt" ["follow-up"...]
 *
 * Each prompt is sent once the previous one's `result` arrives. The probe ends after
 * `--quiet` seconds without any message once the last prompt has been sent, so late
 * subagent output after a result is recorded too. Approvals are answered with
 * `--reply` (default `allow`), questions with "Sencha". `--per-task-stop` declares
 * `perTaskStopAffordance` (an interrupt then spares background subagents);
 * `--summaries` turns on `agentProgressSummaries`. `--interrupt-after-tasks n`
 * interrupts once the n-th subagent task starts; with `--stop-tasks`, every running
 * task is stopped (`stopTask`) five seconds later. `--interrupt-when-idle` interrupts
 * at the first result while subagent tasks still run; `--stop-tasks-when-idle` stops
 * each of them then instead. `--replay` passes `--replay-user-messages`, so each input
 * a turn takes is echoed as it starts. `--send-on-report` sends each follow-up the moment
 * a subagent reports instead of at a result, so it races the report's own turn.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { makeInput, userMessage } from "../src/features/providers/claude-code/sdk.js";
import { HOME, VAULT, VAULT_FILES } from "../tests/fixtures/claude-code/fixture.js";

const { values, positionals } = parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", default: "haiku" },
    quiet: { type: "string", default: "60" },
    reply: { type: "string", default: "allow" },
    "per-task-stop": { type: "boolean", default: false },
    summaries: { type: "boolean", default: false },
    "interrupt-after-tasks": { type: "string" },
    "stop-tasks": { type: "boolean", default: false },
    "interrupt-when-idle": { type: "boolean", default: false },
    "stop-tasks-when-idle": { type: "boolean", default: false },
    replay: { type: "boolean", default: false },
    "send-on-report": { type: "boolean", default: false },
  },
  allowPositionals: true,
});
if (values.out === undefined || positionals.length === 0) throw new Error('usage: --out trace.jsonl [--model haiku] "prompt" ["follow-up"...]');
const out = resolve(values.out);
writeFileSync(out, "");
const quietMs = Number(values.quiet) * 1000;

const root = mkdtempSync(join(tmpdir(), "wiki-agents-probe-"));
for (const [path, content] of Object.entries(VAULT_FILES)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
const started = Date.now();
const log = (entry: Record<string, unknown>) =>
  appendFileSync(out, `${JSON.stringify({ t: Date.now() - started, ...entry }).replaceAll(root, VAULT).replaceAll(homedir(), HOME)}\n`);

const input = makeInput();
const pending = [...positionals];
const send = () => {
  const text = pending.shift();
  if (text === undefined) return;
  log({ sent: text });
  input.push(userMessage(text));
};

const q = query({
  prompt: input.iterable,
  options: {
    cwd: root,
    pathToClaudeCodeExecutable: process.env.WIKI_AGENTS_CLAUDE ?? "claude",
    model: values.model,
    settingSources: [],
    permissionMode: "default",
    // As the adapter runs it, so the order of streamed and whole messages is what it sees.
    includePartialMessages: true,
    ...(values["per-task-stop"] === true ? { perTaskStopAffordance: true } : {}),
    ...(values.summaries === true ? { agentProgressSummaries: true } : {}),
    ...(values.replay === true ? { extraArgs: { "replay-user-messages": null } } : {}),
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (hook) => {
              log({ hook });
              return {};
            },
          ],
        },
      ],
    },
    canUseTool: async (toolName, toolInput, context) => {
      log({ permission: { toolName, toolInput, toolUseID: context.toolUseID, agentID: context.agentID, decisionReason: context.decisionReason, blockedPath: context.blockedPath } });
      if (toolName === "AskUserQuestion") {
        const questions = (toolInput.questions as ReadonlyArray<{ readonly question: string }> | undefined) ?? [];
        return { behavior: "allow", updatedInput: { ...toolInput, answers: Object.fromEntries(questions.map((item) => [item.question, "Sencha"])) } };
      }
      return values.reply === "deny" ? { behavior: "deny", message: "Denied by the probe." } : { behavior: "allow", updatedInput: toolInput };
    },
    stderr: (data) => log({ stderr: data }),
  },
});

let lastMessage = Date.now();
let tasksStarted = 0;
let results = 0;
/** Subagent and shell tasks running now, from `background_tasks_changed` and the task bookends. */
const running = new Set<string>();

const stopTasks = async () => {
  for (const id of [...running]) {
    log({ stopTask: id });
    await q.stopTask(id).then(
      () => log({ stopTaskDone: id }),
      (error: unknown) => log({ stopTaskFailed: id, error: String(error) }),
    );
  }
};
const interrupt = async () => {
  log({ interrupt: true });
  await q.interrupt().then(
    (receipt: unknown) => log({ interruptDone: receipt ?? null }),
    (error: unknown) => log({ interruptFailed: String(error) }),
  );
};

const onMessage = async (message: SDKMessage) => {
  lastMessage = Date.now();
  log({ message });
  if (message.type === "system" && message.subtype === "task_started") {
    running.add(message.task_id);
    if (++tasksStarted === Number(values["interrupt-after-tasks"])) {
      await interrupt();
      if (values["stop-tasks"] === true) setTimeout(() => void stopTasks(), 5000);
    }
  }
  if (message.type === "system" && message.subtype === "task_notification") {
    running.delete(message.task_id);
    if (values["send-on-report"] === true) send();
  }
  if (message.type === "result") {
    results++;
    if (results === 1 && running.size > 0) {
      if (values["interrupt-when-idle"] === true) await interrupt();
      if (values["stop-tasks-when-idle"] === true) await stopTasks();
    }
    if (values["send-on-report"] !== true) send();
  }
};

send();
void (async () => {
  try {
    for await (const message of q) await onMessage(message);
    log({ note: "query ended" });
  } catch (error) {
    log({ note: "query failed", error: String(error) });
  }
})();

while (!(pending.length === 0 && Date.now() - lastMessage > quietMs)) {
  await new Promise((done) => setTimeout(done, 1000));
}
log({ note: "quiet; closing", running: [...running] });
input.close();
q.close();
console.log(`trace written to ${out}`);
process.exit(0);
