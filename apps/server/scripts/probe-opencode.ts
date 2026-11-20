/**
 * Records OpenCode's raw event stream, unfiltered and undecoded, for protocol
 * discovery: every session's events (children included) and event types the pinned
 * protocol doesn't know yet. Starts its own `opencode serve` in a temp copy of the
 * fixture vault; nothing outside the temp folder is touched.
 *
 *   npm run probe:opencode -w @wiki-agents/server -- --out trace.jsonl \
 *     [--model provider/model] [--quiet 60] [--reply once|reject] [--interrupt-after-children n] \
 *     "prompt" ["follow-up"...]
 *
 * Each prompt is sent when the parent session goes idle. The probe ends after
 * `--quiet` seconds without any event once the last prompt's turn has ended, so late
 * child output after the parent goes idle is recorded too. Approvals are answered
 * with `--reply` (default `once`), questions with "Sencha". `--interrupt-after-children n`
 * stops the parent (`session.interrupt`) once its n-th child session is created; with
 * `--stop-children`, its children too, five seconds later; with `--stop-all`, its children
 * first, then the parent, withdrawing the reports that would wake it and stopping any
 * parent execution that starts anyway. `--stop-all-when-idle` does the same once the
 * parent first goes idle with children running.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { VAULT, VAULT_FILES } from "../tests/fixtures/opencode/fixture.js";

const { values, positionals } = parseArgs({
  options: { out: { type: "string" }, model: { type: "string" }, quiet: { type: "string", default: "60" }, reply: { type: "string", default: "once" }, "interrupt-after-children": { type: "string" }, "stop-children": { type: "boolean", default: false }, "stop-all": { type: "boolean", default: false }, "stop-all-when-idle": { type: "boolean", default: false } },
  allowPositionals: true,
});
if (values.out === undefined || positionals.length === 0) throw new Error('usage: --out trace.jsonl [--model p/m] "prompt" ["follow-up"...]');
const out = resolve(values.out);
writeFileSync(out, "");
const quietMs = Number(values.quiet) * 1000;

const root = mkdtempSync(join(tmpdir(), "wiki-agents-probe-"));
for (const [path, content] of Object.entries(VAULT_FILES)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
const started = Date.now();
const log = (entry: Record<string, unknown>) =>
  appendFileSync(out, `${JSON.stringify({ t: Date.now() - started, ...entry }).replaceAll(root, VAULT)}\n`);

const password = randomBytes(24).toString("base64url");
const child = spawn(process.env.WIKI_AGENTS_OPENCODE ?? "opencode", ["serve", "--hostname=127.0.0.1", "--port=0"], {
  env: { ...process.env, OPENCODE_PASSWORD: password },
  stdio: ["ignore", "pipe", "pipe"],
});
const cleanup = () => {
  child.kill("SIGTERM");
  rmSync(root, { recursive: true, force: true });
};
process.on("exit", cleanup);

const url = await new Promise<string>((done, fail) => {
  const onData = (chunk: Buffer) => {
    const match = /server listening on (http:\/\/127\.0\.0\.1:\d+)/i.exec(chunk.toString("utf8"));
    if (match?.[1] !== undefined) done(match[1]);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.once("exit", (code) => fail(new Error(`opencode exited (${code})`)));
});
const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "content-type": "application/json" };
const api = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${url}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  const result = { method, path, status: response.status, body: text === "" ? null : (JSON.parse(text) as unknown) };
  log({ call: result });
  return result.body as { readonly data?: Record<string, unknown> } | null;
};

const version = await api("GET", "/api/server/info").catch(() => null);
log({ note: "server", version });

let lastEvent = Date.now();
let parentId: string | undefined;
let parentIdle = true;
const pending = [...positionals];
let children = 0;
const childIds: Array<string> = [];
let stoppingAll = false;

const onEvent = async (event: { readonly type: string; readonly data?: Record<string, unknown> }) => {
  lastEvent = Date.now();
  log({ event });
  const data = event.data ?? {};
  const session = typeof data.sessionID === "string" ? data.sessionID : undefined;
  if (event.type === "permission.asked" && session !== undefined) {
    await api("POST", `/api/session/${session}/permission/${String(data.id)}/reply`, values.reply === "reject" ? { decision: "reject", message: "Denied by the probe." } : { decision: "once" });
  }
  if (event.type === "form.created") {
    const form = data.form as { readonly id: string; readonly sessionID: string; readonly fields: ReadonlyArray<{ readonly key: string }> };
    await api("POST", `/api/session/${form.sessionID}/form/${form.id}/reply`, { answer: Object.fromEntries(form.fields.map((field) => [field.key, "Sencha"])) });
  }
  if (stoppingAll && session === parentId && event.type === "session.inbox.enqueued") {
    await api("DELETE", `/api/session/${parentId}/inbox/${String(data.inboxID)}`);
  }
  if (stoppingAll && session === parentId && event.type === "session.execution.started") {
    await api("POST", `/api/session/${parentId}/interrupt`);
  }
  if (event.type === "session.created" && data.parentID !== undefined) childIds.push(String(data.sessionID));
  if (event.type === "session.created" && data.parentID !== undefined && ++children === Number(values["interrupt-after-children"])) {
    if (values["stop-all"] === true) {
      // Stop everything at once: the children, then the parent, and every parent execution a cancelled report starts.
      stoppingAll = true;
      await Promise.all(childIds.map((id) => api("POST", `/api/session/${id}/interrupt`)));
    }
    await api("POST", `/api/session/${parentId}/interrupt`);
    if (values["stop-children"] === true) {
      setTimeout(() => void Promise.all(childIds.map((id) => api("POST", `/api/session/${id}/interrupt`))), 5000);
    }
  }
  if (session === parentId && event.type === "session.execution.started") parentIdle = false;
  if (session === parentId && /^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type)) {
    parentIdle = true;
    if (values["stop-all-when-idle"] === true && !stoppingAll && childIds.length > 0) {
      // Stop everything while only the children run.
      stoppingAll = true;
      await Promise.all(childIds.map((id) => api("POST", `/api/session/${id}/interrupt`)));
      await api("POST", `/api/session/${parentId}/interrupt`);
    }
    const next = pending.shift();
    if (next !== undefined) await api("POST", `/api/session/${parentId}/prompt`, { text: next });
  }
};

const stream = await fetch(`${url}/api/event`, { headers });
if (stream.body === null) throw new Error("no event stream");
void (async () => {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data === "") continue;
      try {
        await onEvent(JSON.parse(data) as { readonly type: string });
      } catch (error) {
        log({ note: "unparsed", data, error: String(error) });
      }
    }
  }
})();

const permissions = [
  { action: "*", resource: "*", effect: "ask" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "list", resource: "*", effect: "allow" },
];
const model = values.model === undefined ? undefined : { providerID: values.model.slice(0, values.model.indexOf("/")), id: values.model.slice(values.model.indexOf("/") + 1) };
const created = await api("POST", "/api/session", { location: { directory: root }, permissions, ...(model === undefined ? {} : { model }) });
parentId = created?.data?.id as string | undefined;
if (parentId === undefined) throw new Error("no session created");
log({ note: "parent", parentId });
await api("POST", `/api/session/${parentId}/prompt`, { text: pending.shift() });
parentIdle = false;

while (!(parentIdle && pending.length === 0 && Date.now() - lastEvent > quietMs)) {
  await new Promise((done) => setTimeout(done, 1000));
}
await api("GET", "/api/session");
await api("GET", `/api/session/${parentId}/message`);
console.log(`trace written to ${out}`);
process.exit(0);
