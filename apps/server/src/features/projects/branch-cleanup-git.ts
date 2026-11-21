import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runGit } from "./git.js";

export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export async function repositoryIdentity(directory: string) {
  const common = await runGit(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) return null;
  return realpath(common.stdout.trim()).catch(() => null);
}

export async function inspectBranch(directory: string, ref: string, repository?: string) {
  const gitDir = repository === undefined ? [] : [`--git-dir=${repository}`];
  const result = await runGit(directory, [...gitDir, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)%00%(worktreepath)", "--", ref]);
  if (result.code !== 0) return { status: "unknown" } as const;
  // Git may also return refs below the specified prefix. Match the exact name.
  const row = result.stdout.split("\n").find((line) => line.startsWith(ref + "\0"));
  if (row === undefined) {
    const exists = await runGit(directory, [...gitDir, "show-ref", "--exists", ref]);
    return exists.code === 2 ? { status: "missing" } as const : { status: "unknown" } as const;
  }
  const [, tip, symbolic, occupied] = row.split("\0");
  if (!oid.test(tip ?? "") || symbolic !== "" || occupied === undefined) return { status: "unknown" } as const;
  return { status: "present", tip: tip!, occupied: occupied !== "" } as const;
}

export async function branchIdentity(repository: string, ref: string, tip: string) {
  // A recreated branch can point at the same commit. Require its original reflog
  // file and contents as well as the tip. Repositories without that evidence fail closed.
  const log = join(repository, "logs", ref);
  try {
    const before = await stat(log, { bigint: true });
    const content = await readFile(log);
    const after = await stat(log, { bigint: true });
    if (before.ino !== after.ino || before.ctimeNs !== after.ctimeNs) return null;
    return digest([repository, ref, tip, String(after.dev), String(after.ino), String(after.birthtimeNs), String(after.ctimeNs), content.toString("base64")]);
  } catch {
    return null;
  }
}

export async function captureRemovedBranch(directory: string, worktree: string, branch: string) {
  const ref = `refs/heads/${branch}`;
  const [repository, worktreeRepository, head, local] = await Promise.all([
    repositoryIdentity(directory),
    repositoryIdentity(worktree),
    runGit(worktree, ["symbolic-ref", "--quiet", "HEAD"]),
    inspectBranch(directory, ref),
  ]);
  if (repository === null || repository !== worktreeRepository || head.code !== 0 || head.stdout.trim() !== ref || local.status !== "present") return null;
  return branchIdentity(repository, ref, local.tip);
}

/**
 * Git's worktreepath atom uses the same checked-out branch lookup as git branch,
 * including rebase and bisect. Recheck it after preparing the compare-and-delete
 * transaction, while both refs are locked. Git's checkout also has a window
 * between inspecting a ref and updating a worktree's HEAD.
 */
export async function deleteVerifiedRef(
  directory: string,
  repository: string,
  ref: string,
  tip: string,
  identity: string,
  target: string,
  targetTip: string,
) {
  const child = spawn("git", ["--no-pager", "-C", directory, `--git-dir=${repository}`, "update-ref", "--no-deref", "--stdin"], {
    detached: true,
    env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const exited = new Promise<boolean>((resolve) => {
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
  child.stdin.on("error", () => {});
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const stop = () => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
    }
  };
  const timeout = setTimeout(stop, 15_000);
  try {
    child.stdin.write(`start\nverify ${target} ${targetTip}\ndelete ${ref} ${tip}\nprepare\n`);
    if ((await lines.next()).value !== "start: ok" || (await lines.next()).value !== "prepare: ok") return false;
    const local = await inspectBranch(directory, ref, repository);
    if (local.status !== "present" || local.occupied || local.tip !== tip || (await branchIdentity(repository, ref, tip)) !== identity) return false;
    child.stdin.end("commit\n");
    return await exited;
  } finally {
    if (!child.stdin.writableEnded) child.stdin.end("abort\n");
    await exited;
    clearTimeout(timeout);
  }
}
