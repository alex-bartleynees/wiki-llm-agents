# Effect services for IO

Server code uses Effect's `FileSystem`, `ChildProcess` and `HttpClient`. Failures are then typed inside an adapter as well as at its edge, resources close with their scope, work stops on interruption, and tests can inject failures by providing a layer. `node:path`, `node:crypto` and `node:os` helpers stay as they are. `npm run lint:effect-io`, part of `npm run check`, refuses new direct use of `node:fs`, `node:child_process` or `fetch` in `apps/server/src`, tests excluded. Exceptions are listed in `scripts/effect-io-exceptions.json`, and an unused one fails the lint.

## Lasting exceptions

`shared/node-files.ts` wraps the calls Effect 4.1.2 has no equivalent for:

- `readRegularFile` opens with `O_NOFOLLOW` and `O_NONBLOCK`. `FileSystem.open` has `noFollow`, but without `O_NONBLOCK` a file swapped for a FIFO would block the open, and the lock its caller holds, until a writer appeared.
- `preciseStat` gives the nanosecond `ctime` that branch identity depends on. `File.Info` has no `ctime`. Its bigint values also keep previously recorded identities valid.
- `removeEmptyDirectory` is `rmdir`. `FileSystem.remove` uses `fs.rm`, which refuses a directory unless it is recursive, and a recursive removal could delete files that someone else added.

`persistence/sqlite.ts` creates the folder for a synchronous native driver. The replay provider stays synchronous so test-clock playback can't run ahead of it.

## Not converted yet

The provider launchers (`binary.ts`, OpenCode and Codex) own long-lived processes and are a separate change. `oauth-client.ts`, `push-sender.ts` and the replay provider's vault tools still use `fetch`.

## Consequences

Skill operations used to be atomic because they were synchronous. The `Skills` layer now holds a semaphore: up to four reads share it and a mutation takes all of it, so a reader never sees a half-finished install as one needing recovery. Mutations, including activation and recovery, are uninterruptible once they hold the lock, so a closed request can't stop one halfway. The lock covers one server process; the install journal and version checks still cover outside changes. Bundle files are hashed as they are read, which keeps the digest format and avoids hashing a whole bundle in one turn of the event loop.

Git runs with `detached: false` for short commands, so a file-system monitor daemon that Git starts isn't killed with it. An interrupted read stops Git. `git worktree add` and `git worktree remove` are uninterruptible, because stopping one midway leaves a partial worktree. Deleting a verified branch has its own process group and a 15-second limit, ending in SIGTERM and then SIGKILL after five seconds so that Git can release its ref locks first.

`File.Info` has millisecond times. File baselines recorded earlier may have fractional milliseconds, so scans compare whole milliseconds.

Semantic search has its own fetch-based `HttpClient` that refuses redirects. The test app's ambient client points at the app itself, and so must not be used for rag-ai.

Git commands that only read live in `git.ts`; the writes a user starts are in `worktree-git.ts` and `commit-git.ts`. Git runs without a shell, pager, colour, external diff or textconv, in one working directory at a time, with literal pathspecs for file names, so a name is never a glob or an option.
