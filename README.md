# wiki-agents

Local-first app that puts a wiki-llm Obsidian vault and coding agents (OpenCode
first, then Claude Code) in one place. Working name; the app isn't named yet.

Design and plans live in the vault: `1-Active/Wiki-LLM-Agents-App/` (README,
Architecture, Implementation Plan, Code Organisation, OpenCode Integration). The UI
mockup is in `design/`.

## Commands

All commands run through the Nix dev shell; there is no global Node.

| Command | What it does |
|---|---|
| `nix run .#dev` | Server (watch mode, port 4317) and Vite (port 5173) together; open http://127.0.0.1:5173 |
| `nix develop -c npm test` | All tests, including the UI flows |
| `nix develop -c npm run test:e2e -w @wiki-agents/web` | UI flows only (Playwright, desktop and phone widths) |
| `nix develop -c npm run check` | Type checks (tsc, svelte-check) |
| `nix develop -c npm run build` | Build contracts, server, and web app |
| `nix build` | Package to `result/bin/wiki-agents` |
| `nix develop -c npm run db:generate -w @wiki-agents/server` | Generate a Drizzle migration after changing a `table.ts` |

Gate before every commit: `npm test`, `npm run check`, `npm run build`, `git diff --check`.

### UI tests

- **Flows** (`apps/web/e2e/`, Playwright): key flows at 1440px and 390px through the
  real app: the server from source serving a fresh web build, on a random port, with a
  temporary vault, data and config folder (never 4317 or `.data/`). OpenCode points at
  a missing binary, so threads use the free replay provider. Failures keep a trace in
  `apps/web/test-results/` (`npx playwright show-trace <trace.zip>`).
- **Stores** (`*.browser.test.ts`, Vitest browser mode): stateful stores in a real
  Chromium, with the API and event streams stood in for, so a test decides when
  answers arrive. Pure logic stays in plain `*.test.ts`.
- The browsers come from Nix (`playwright-driver.browsers`, set in the dev shell).
  `@playwright/test` and `playwright` must be the same version as nixpkgs'
  `playwright-driver`; the Playwright config stops with a message when they differ.
  After a nixpkgs update, pin both to the new version and update `npmDepsHash`.

## Vaults

Register a vault on the settings screen (⚙ in the vault pane; it also lists the
providers, whether each is installed, signed in, and its version), with
`POST /api/vaults {"rootPath": "..."}`, or at startup with `--vault <path>` (repeatable;
registering is idempotent). In development, work on a copy so the real vault stays
untouched:

```bash
rsync -a --exclude .git ~/Documents/obsidian-vault/ .data/vault/
nix develop -c npm run dev -w @wiki-agents/server -- --vault ../../.data/vault
```

Each vault is indexed into SQLite (files, notes, links, full-text search) when it is
registered and at every start, and a watcher keeps the index current; the open note,
the tree, and backlinks update live over `/events/vaults/:id`. The index can always
be rebuilt from disk: `POST /api/vaults/:id/rebuild-index`.

### Search

- **Quick switcher** (⌘K / Ctrl K, or the header box): fuzzy match on note titles
  and paths (`GET /api/vaults/:id/quick-switch?q=`). With nothing typed it lists
  pinned and recent notes; ⌘↵ sends the text to full-text search.
- **Full-text search** (⌘⇧F / Ctrl Shift F; the sidebar's Search tab on desktop,
  the Search tab on phone): `GET /api/vaults/:id/search?q=&tags=a,b`, over FTS5 with
  bm25 ranking (title, then tags, then body). Words match by prefix, `"quoted
  phrases"` exactly; nothing else is query syntax. Tag filters include child tags
  (`project` matches `project/app`). Snippets are sent as text parts, never HTML.
- **Pins** are stored on the server (`/api/vaults/:id/pins`), so every device sees
  them; **recent notes** are kept per device in `localStorage`. The note's
  **Outline** lists its headings.

### Threads

The right-hand pane (the Chat tab on phone) holds the vault's agent threads. Pick the
provider and the agent (below) for new threads next to **New thread**:

- **OpenCode** (the default): your installed `opencode` 2.2.x, with your own login and
  config. The app runs one `opencode serve` on a free localhost port with a generated
  password, started with the first thread that needs it and stopped 5 minutes after
  the last one closes (and with the app). Each thread is an OpenCode session in the
  vault's folder; the thread keeps its session id, so a later message, even after a
  restart, continues the same conversation. Pick the thread's model in its header
  (`GET /api/threads/:id/models`, `PUT /api/threads/:id/model`).
  **Approvals are real:** what OpenCode may do unasked is the thread's agent's
  autonomy (without an agent: read, and ask before editing or creating a file, a
  command, or the web); anything outside the vault's folder and any tool the app
  doesn't know always asks, and approving changes the files. The app answers `once`, never `always` (OpenCode would remember
  that for every thread in the folder). A denial tells the agent why, and it carries
  on. Develop against a copy of the vault (below).
  `GET /api/providers/opencode/status` checks it is installed, a supported version,
  and starts, without opening a session.
  The app passes OpenCode a generated password in `OPENCODE_PASSWORD`. A sandbox
  that drops it (landrun passes only the variables it is given) is fine: OpenCode
  then prints a password of its own, and the app uses that. The sandbox has to let
  OpenCode listen on localhost and write in the vault.
  If OpenCode crashes or is killed, the running turn fails with a reason (its pending
  approvals and questions go with it), and the next message starts a new OpenCode
  and continues the same session. Threads run turns at the same time, each in its
  own session on the one server.
- **Claude Code**: your installed `claude` 2.1.x, with your own login, settings,
  skills, MCP servers and `CLAUDE.md`/`AGENTS.md`, run through the Claude Agent SDK
  (`@anthropic-ai/claude-agent-sdk`, pinned to the version that matches 2.1.316). Each
  thread is one Claude Code session in its working folder, with an id the app chooses;
  one `claude` process serves it while the thread is open (closed 5 minutes after it
  goes idle, and with the app), and a later message, even after a restart, resumes the
  session. Pick the model in the thread's header (Claude Code's own list: `default`,
  `opus`, `sonnet`, `haiku`...).
  **Approvals:** an app hook answers every tool call from the agent's autonomy, ahead
  of Claude Code's own rules and your settings' allow rules; "ask" becomes an approval
  (edits show their diff), and `AskUserQuestion` becomes a question. `Write` to a file
  that doesn't exist yet is *create*, anything else *edit*. Files outside the working
  folders always ask. Claude Code has no Glob or Grep: it lists and searches files with
  shell commands, so while commands ask, the hook leaves commands to Claude Code, which
  runs the ones it judges read-only (`ls`, `find`, `grep`...) without asking.
  Usage is reported per turn; cost only when you pay per token (an API key), not on a
  claude.ai plan. The vault tools' token goes to Claude Code over its control channel,
  never on its command line. Stop asks Claude Code to stop and waits up to 5 s for it
  to confirm, otherwise closes the process (the next message resumes the session); a
  crash fails the turn with the reason and the next message starts a new process. A
  running Claude Code turn can't survive an app restart (it is a child process), so it
  is closed as interrupted. Stopping the app with an open Claude Code session takes a
  few seconds: the SDK gives `claude` 2 s to exit before it sends SIGTERM.
- **Replay** plays recorded turns and spends no tokens; the message picks the
  recording by keyword (`providers/replay/transcripts.ts`): *edit* proposes an edit
  to `Replay note.md` in the thread's folder and, once you apply it, really appends a
  line (creating the note if needed), so change review and undo can be tried for free;
  *question* (or *ask*) asks a question, *long* streams slowly (for trying Stop and
  reloads), *fail* fails, and anything else gives a plain answer.

- `POST /api/vaults/:id/threads` creates a thread; `POST /api/threads/:id/messages`
  starts a turn (409 while one runs); `POST /api/threads/:id/interrupt` stops it;
  `POST /api/threads/:id/requests/:requestId` answers an approval or question.
- **Mark done** (in the thread's header) moves an idle thread to the collapsed
  **done** group at the bottom of the list (`POST /api/threads/:id/done`; 409 while a
  turn runs or waits for you). **Reopen** moves it back (`POST /api/threads/:id/reopen`),
  and so does sending it a message.
- Each thread has a **ThreadActor** (`features/threads/thread-actor.ts`): one mailbox
  and one fiber, so sends, interrupts, answers, and provider events never race. It
  writes to SQLite before it publishes, and rebuilds its state from SQLite.
- Event streams end when the server starts shutting down (browsers reconnect and
  resume), so a restart doesn't wait for them.
- `GET /events/threads/:id?after=<seq>` streams the thread's stored events after
  `seq`, then live ones; reconnecting browsers send `Last-Event-ID`, so a reload or a
  dropped connection mid-turn misses nothing and repeats nothing.
- At startup the server wakes threads left mid-turn: a turn that never reached the
  provider is started, one waiting on an approval or question stays answerable
  (replay), and one that was streaming is closed as interrupted. OpenCode can't
  resume: its server stops with the app and cancels the turn and its pending
  approvals, so an OpenCode turn cut off by a restart is closed as interrupted.

### Vault context and MCP

Each thread gets authenticated vault tools at `/mcp`, registered with OpenCode for
its vault directory. Tokens expire after four hours, renew before the next turn
when half their lifetime remains, and are revoked when the actor closes. Failed
registration shows a notice to the user and agent; the turn can continue.

Tools: `vault_search`, `vault_read_note` (optionally one heading), `vault_note_info`,
`vault_backlinks`, `vault_resolve_link`, `vault_related`, `vault_open_note`,
`vault_recent_changes`, and `vault_status`. Arguments are strict. Search is FTS5
only and says so; limits and truncation are reported. Search hops and Related notes
share graph ranking (direct links, Adamic-Adar shared neighbours, tags, folder).

The composer accepts `@Folder/Note.md` references, separated by semicolons, with
matching note suggestions. Include open note or select text in the note and choose
Include selection. Start a thread directly from a note or inbox item. Supplied
content and MCP reads store a SHA-256 version with the turn; context is capped at
16,000 characters per note and ten supplied notes per message. A stale selection
is refused rather than silently including different text. Thread context links
back to notes, and notes list the threads using them.

Replies cite `[[Folder/Note#Heading]]`, displayed as numbered links. Unresolved
citations stay visible. Citations are recorded separately from supplied/retrieved
context: they do not establish that the provider read that file version. File reads
through other provider tools are not tracked. Live `vault_open_note` events open
the note; replaying stored history never navigates the reader.

Search evaluation fixtures and fixed relevance judgements live in
`apps/server/tests/fixtures/search-eval/`. Run the evaluation against the real HTTP
app with `nix develop -c npm test -w @wiki-agents/server -- search-eval`.
Save as note is still to do.

### Projects

**Projects** in the header opens `/projects`: the projects, each with its working
directories, shared vault, threads and changed files, and a form to register one
(an existing folder or a new empty one as the main directory, more directories,
and an optional existing notes folder inside the shared vault). Each project has
two views, switched with **Overview | Threads**: the overview (the default,
`/projects/<id>`), and the project's threads with the open one in the middle and
the project beside it (`/projects/<id>/threads`), where **New thread here** and
**Open** go. The Projects page shows only project threads; threads without a
project are in the wiki, whose **Threads in** select switches between all of the
vault's threads and one project's. The shared vault is the
vault registered first; several vaults per project, and a vault picker, are deferred.
`/`, `/home` and the home folder itself are refused as working directories.

A project's threads run in its main directory and keep their project across
restarts. They reach the shared vault through their vault tools (MCP), supplied
notes and the rules. The threads pane remembers the open thread separately for each
project. With a vault open that the selected project doesn't use, all of that
vault's threads show.

- `POST /api/projects {name, workingDirectories, notesFolder?, createDirectories?}`
  registers a project, checking everything before creating any folder;
  `GET /api/projects` lists projects, archived ones included (`archivedAt`).
- `POST /api/projects/:id/archive` (**Archive** on the project) moves a project out of
  the project switchers into the list's **archived** group and refuses new threads
  in it; its threads and changed-file baseline are kept.
  `POST /api/projects/:id/restore` (**Restore project**) makes it active again.
- `POST /api/vaults/:id/threads` accepts `projectId`.
  `GET /api/vaults/:id/threads?projectId=…` lists that project's threads,
  `?projectId=none` the vault's own; without it, every thread in the vault.
- `GET /api/projects/:id/changes` (shown on the project, **Rescan**) compares every working
  directory with the baseline: the files when the project was registered or last
  marked reviewed (`POST /api/projects/:id/changes/review`, **Mark all
  reviewed**). It reports created, modified and deleted files, including changes
  made outside the app, without saying who made them. Symlinks, version-control
  metadata and dependency/build/cache folders (`node_modules`, `dist`, `target`,
  `.venv`, Nix's `result`...) are left out, and inside a git repository so is
  everything `.gitignore` excludes (nested repositories use their own). A rescan
  reads only files whose size or modification time changed, so large repositories
  stay quick (200,000 files: about 5 s to register, 2 s to rescan). A folder that
  has gone or moved fails the scan (409) rather than reporting every file as
  deleted.
- In OpenCode project sessions, everything inside the project follows the agent's
  autonomy, as for vault threads: an agent allowed to edit edits without asking.
  When OpenCode asks to reach outside the main directory, the app allows the
  project's other working directories and the shared vault itself (resolving
  symlinks) and asks you about anywhere else. Shell commands follow command
  autonomy; this is a permission boundary, not an OS sandbox.
- Review and undo code changes with lazygit/git. In-app project diffs/restore are
  deferred; changes a project thread makes to the shared vault get change review
  (below).
- Folders are chosen with **Browse…** (project directories, the vault folder) or
  typed. A browser never gives a page a folder's real path, so the picker walks
  the server's machine through `GET /api/folders?path=…` (default: the home
  folder; dot-folders hidden). It lists folder names anywhere this user can read,
  so like the rest of the API it relies on the server listening on localhost (the
  default; mind `WIKI_AGENTS_HOST`) and checking the Origin. The notes folder
  is picked from the shared vault's own folders.

### Agents and rules

Named agents and the rules every agent follows are markdown files in the app's
config directory (`WIKI_AGENTS_CONFIG_DIR`, default `~/.config/wiki-agents`), not in a
vault, so every vault gets them. The first start writes `rules/wiki-llm.md` and four
agents (`agents/researcher.md`, `librarian`, `builder`, `reviewer`); after that the
files are yours: edits and deletions stick. The app reloads them when they change.
To have the same agents on every machine, point `WIKI_AGENTS_CONFIG_DIR` at a
Syncthing folder outside your vaults (outside, so an agent always has to ask before touching
its own instructions), and let it finish syncing before the first start on a new machine, or
that machine's fresh defaults would win over your edits. A Syncthing conflict copy
(`*.sync-conflict-*.md`) isn't loaded; the Agents screen lists it.

- An agent file's body is its instructions; its frontmatter holds `name`,
  `description`, `provider` and `model` (defaults for new threads), `sources`,
  `concurrency`, and `autonomy` per action (`read`, `create`, `edit`, `commands`,
  `web`: `allow`, `ask`, or `deny`; `always` and `never` work too). Anything left out
  reads freely and asks for the rest. Unknown keys are errors, so typos can't pass.
- A file that doesn't load is listed on the Agents screen with the reason; the other
  agents still work. A thread whose agent is missing or broken fails its next turn
  saying so, rather than running without it.
- Each turn the thread's provider gets every `rules/*.md`, then the agent's
  instructions, then the vault's own `AGENTS.md` if it has one, and the agent's
  autonomy. OpenCode gets them as one session instruction entry (`<context
  key="wiki-agents">`) and session permission rules, sent only when they change; it
  reads `AGENTS.md` itself, so the app doesn't send it twice. OpenCode can't tell
  creating a file from editing one: both get the stricter level, and the agent screen
  says so. Claude Code gets them appended to its system prompt (rebuilt every request,
  so a change applies from the next turn on the same session) and the autonomy through
  the app's hook; it reads `AGENTS.md` and `CLAUDE.md` itself, so those aren't sent.
- Pick a thread's agent in its header; it applies from the next message.
  The Agents tab (phone) or the right pane's Agents switch (desktop) lists agents
  with what they are doing in this vault, and shows each one's autonomy as written
  and as each provider enforces it.
- `GET /api/agents`, `GET /api/agents/:id`, `PUT /api/threads/:id/agent`
  (`{"agentId": "researcher"}` or `null`), and `agentId` on `POST
  /api/vaults/:id/threads`.

#### OpenCode tests and recordings

The OpenCode adapter is tested against real OpenCode event streams recorded into
`apps/server/tests/fixtures/opencode/*.json` and played back by a fake server
(`fake-api.ts`), so tests spend nothing and need no OpenCode. To record them again
(after upgrading OpenCode, say), on OpenCode's default model unless `--model` says
otherwise:

```bash
nix develop -c npm run record:opencode -w @wiki-agents/server -- [scenario...]
```

One opt-in test runs a real turn on the installed OpenCode:
`WIKI_AGENTS_LIVE_OPENCODE=1 nix develop -c npx vitest run tests/live` (in
`apps/server`).
For a model-free MCP registration smoke test, run
`WIKI_AGENTS_LIVE_OPENCODE=1 nix develop -c npm test -w @wiki-agents/server -- tests/live/mcp-registration.live.test.ts`.
It starts real OpenCode, connects to the authenticated app endpoint, and removes
the registration without invoking a model.

#### Claude Code tests and recordings

The Claude Code adapter is tested the same way: real conversations recorded through
the real adapter and SDK into `apps/server/tests/fixtures/claude-code/*.json` (Claude
Code's messages, cut down, and what the app's hook and `canUseTool` answered), played
back by a fake SDK (`fake-sdk.ts`) that checks the adapter answers as it did when
recorded. Scenarios: as for OpenCode, plus create vs edit and a command the autonomy
denies. To record them again, on Haiku unless `--model` says otherwise (this spends a
little of your plan or credit):

```bash
nix develop -c npm run record:claude-code -w @wiki-agents/server -- [scenario...]
```

One opt-in test runs a real turn on the installed Claude Code:
`WIKI_AGENTS_LIVE_CLAUDE=1 nix develop -c npx vitest run tests/live/claude-code.live.test.ts`
(in `apps/server`).

The SDK lists a `claude` binary for every platform (about 330 MB each) as optional
dependencies. The root `overrides` point them at an empty stand-in
(`nix/claude-agent-sdk-no-binary`), so neither npm nor Nix downloads them; the app runs
your installed `claude`. When upgrading the SDK, keep it on the version whose
`claudeCodeVersion` matches the installed Claude Code.

#### OpenCode client

The client library is `@opencode/client` (and `@opencode/protocol`), pinned to exactly
the installed OpenCode's version (2.2.1); they ask for an older `effect`, which the
root `overrides` replaces with the app's, so there is one copy.

### Change review

Every note a turn changes in its thread's vault is recorded, with the version before
and after, and listed on the turn's card in the conversation: created, edited or
deleted, a diff, and **Undo**.

- **How it is recorded.** The indexer tells the change tracker
  (`features/changes/change-tracker.ts`) about every note whose content changes,
  before it forgets the old version; while a turn runs in that vault, the change is
  added to the turn's `file_changes` row for the path (the first version before,
  the last after; a note changed and changed back has no row). When the turn ends the
  vault is scanned once more, so writes the watcher hasn't reported yet count. The
  versions live in the index's `blobs`, which keeps every version a change refers
  to. Only notes (`.md`) are tracked; images and other files aren't.
- **Who made it.** A change is the agent's when the provider reported writing that
  file during the turn (OpenCode's edit, write and patch tools; replay's edit);
  otherwise it is **uncertain**: you, Syncthing, or one of the agent's shell commands.
  With two turns running in one vault, each records the other's unreported changes as
  uncertain.
- **Undo** (`POST /api/changes/:changeId/undo`) writes the version from before the
  turn back, or deletes a note the turn created, only if the file is still what the
  turn left. If it has changed since, undo is refused (409) and the card shows the
  three versions: before the turn, as the turn left it, and now
  (`GET /api/changes/:changeId`). Undoing is recorded in the thread
  (`change.undone`), and isn't itself recorded as a change of a running turn.
- **Proposed edits.** An edit approval shows each file's diff and is answered with
  **Apply** or **Deny**.
- **Edit warnings** on proposed edits and changed notes, never blocking: the body
  shrank below 70% of its old length, the frontmatter title or first heading changed,
  or frontmatter keys or tags were dropped.
- Diffs kept in the conversation are cut to 300 lines and 16,000 characters (the
  card says so); **Compare versions** shows the whole files.
- A note an agent changed says **edited by Researcher · 2 hours ago** next to its modified
  time, linking to the thread, until that change is undone.

Agents change files when their autonomy allows it or you approve. Dot-folders
(`.git`, `.obsidian`, `.trash`, `.stfolder`...) and Syncthing conflict copies are
hidden, and the path guard refuses anything that resolves outside the vault,
symlinks included.

### Untrusted content

Notes are rendered on the server and sanitised (`rehype-sanitize`). Every vault file
served by `/api/vaults/:id/files` carries a CSP `sandbox`, so it gets an opaque
origin even when opened directly in a tab:

- images, SVG, PDF, JSON, and downloads: no script at all
- JSON files (`?json=` in the app) are drawn as a collapsible tree by the web app,
  using text interpolation only (never `{@html}`); only `http(s)` strings become
  links. A file holding JSON encoded as a string is shown decoded
- HTML pages (`?page=` in the app, inside `<iframe sandbox="allow-scripts">`):
  scripts run, so chart and report pages work, but they cannot reach the app's DOM,
  storage, or API, cannot fetch or send data (`connect-src 'none'`, images only from
  the app or `data:`), and cannot submit forms, open popups, or navigate the app.
  Scripts may load only from unpkg, jsdelivr, and cdnjs. `localStorage` and
  `sessionStorage` are replaced by in-memory stand-ins, since a sandboxed page can't
  use real ones. Never add `allow-same-origin` to the frame.

## Layout

```
apps/server/        Node + Effect HTTP server (API, SSE, MCP, actors, SQLite); serves the web build
apps/web/           SvelteKit SPA (adapter-static), no server code
packages/contracts/ Effect Schemas shared by both: <feature>/<operation>/{request,response}.ts
nix/                package.nix (buildNpmPackage); home-manager and NixOS modules later
design/             Claude Design mockup
```

## Configuration

| Variable | Default |
|---|---|
| `WIKI_AGENTS_HOST` | `127.0.0.1` |
| `WIKI_AGENTS_PORT` | `4317` |
| `WIKI_AGENTS_DATA_DIR` | `$XDG_DATA_HOME/wiki-agents` (`.data/` in `nix run .#dev`) |
| `WIKI_AGENTS_STATIC_DIR` | unset; the packaged binary points it at the web build |
| `WIKI_AGENTS_MIGRATIONS_DIR` | `apps/server/drizzle` |
| `WIKI_AGENTS_OPENCODE` | `opencode` (looked up on `PATH`) |
| `WIKI_AGENTS_CLAUDE` | `claude` (looked up on `PATH`) |
| `WIKI_AGENTS_CONFIG_DIR` | `$XDG_CONFIG_HOME/wiki-agents` (rules and agents) |
| `WIKI_AGENTS_WATCH_POLL_MS` | unset (file system events); set to poll vault files, e.g. `2000`, when the vault is a virtiofs or SSHFS mount whose changes the OS doesn't report |

## Run as a service

The flake exports a home-manager module, `homeManagerModules.default`, which runs
the app as a user service under `wiki-agents.target`. Add the repo as an input of
your NixOS or home-manager flake:

```nix
inputs.wiki-agents = {
  url = "github:alex-bartleynees/wiki-llm-agents";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

Then, in the home-manager user (as a NixOS module or standalone, like `services.t3`):

```nix
imports = [ inputs.wiki-agents.homeManagerModules.default ];

services.wiki-agents = {
  enable = true;
  enableLinger = true;                                  # start at boot, keep running after logout
  vaults = [ "/home/alexbn/Documents/obsidian-vault" ];
  port = 4320;                                          # 4317 is `nix run .#dev`'s
  watchPollMs = 2000;                                   # vault on virtiofs (dev-vm) or SSHFS (exe.dev)
};
```

Options: `vaults`, `host` (default `127.0.0.1`), `port` (default `4317`), `dataDir`,
`configDir` (rules and agents; never written by Nix), `watchPollMs`, `opencode` (a
package; default: `opencode` from your user profile, which must be 2.2.x), `claudeCode`
(a package; default: `claude` from your user profile, which must be 2.1.x),
`environment`, `enableLinger` and `desktopEntry` (default off). `nix flake check`
builds a home-manager configuration with the module (`checks.hm-module`).

- Agents run only while the machine is up and the service runs: threads pause with
  the machine, and later reminders and scheduled tasks will wait for it too.
  `enableLinger` keeps the service running without a login session.
- Logs: `journalctl --user -u wiki-agents -f`. Restart:
  `systemctl --user restart wiki-agents.target`. Migrations run at start, so an
  update is `nix flake update wiki-agents` and a switch.
- **Reaching it from another machine.** It listens on loopback by default. From the
  desktop, either tunnel (`ssh -L 4320:127.0.0.1:4320 dev-vm`, then open
  http://127.0.0.1:4320) or, on dev-vm's host-only network, set
  `host = "10.0.0.2"` and open port 4320 in the VM's firewall
  (`networking.firewall.allowedTCPPorts`). There is no login yet: whoever reaches
  the port can use the app, and the folder picker lists folder names this user can
  read, so don't listen on an address others can reach.
- **The real vault.** Agent edits to the vault's notes are listed on each turn with a
  diff and undo (Change review, above); they follow each agent's autonomy, which asks
  before edits by default. Files other than notes, and anything outside the vault,
  have no in-app undo: use git, Syncthing versioning or backups.
