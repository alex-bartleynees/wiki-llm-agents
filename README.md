# wiki-agents

Local-first app that puts a wiki-llm Obsidian vault and coding agents (OpenCode
first, then Claude Code and Codex) in one place. Working name; the app isn't named yet.

Design and plans live in the vault: `1-Active/Wiki-LLM-Agents-App/` (README,
Architecture, Implementation Plan, Code Organisation, OpenCode Integration). The UI
mockup is in `design/`.

## Commands

All commands run through the Nix dev shell; there is no global Node.

| Command | What it does |
|---|---|
| `nix run .#dev` | Server (watch mode, port 4317) and Vite (port 5173) together; open http://127.0.0.1:5173. The server always uses `127.0.0.1:4317`, `.data/` (or `WIKI_AGENTS_DEV_DATA_DIR`) and this checkout's migrations, even when the shell exports an installed service's `WIKI_AGENTS_*` settings |
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
  temporary vault, data and config folder (never 4317 or `.data/`). OpenCode, Claude
  Code and Codex point at missing binaries, and `WIKI_AGENTS_TEST_HOOKS=true` adds the
  replay provider (see Threads), so turns cost nothing. Failures keep a trace in
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
the tree, and backlinks update live over the tab's event stream (the `vault` topic, see Threads). The index can always
be rebuilt from disk: `POST /api/vaults/:id/rebuild-index`.

Fenced `mermaid` blocks render as diagrams in the note reading view. Expand
**Diagram source** to see the Markdown code; invalid diagrams show their source
and an error without interrupting the rest of the note.

### Editing

**Edit** in a note's header (⌘E / Ctrl E toggles; the URL gets `&edit`) opens its
markdown in CodeMirror 6: markdown and YAML frontmatter highlighting, undo, search
(⌘F), and line endings kept as the file has them. CodeMirror loads only when you
first edit.

- **Saves** when typing pauses for a second, on leaving the editor or the note,
  when the tab is hidden, and on ⌘S. The status above the editor says Unsaved,
  Saving…, Saved, or why a save failed (with Retry; a failed save doesn't retry by
  itself). Leaving the page with unsaved text asks first.
- **Hash-checked:** `GET /api/vaults/:id/note/source?path=` returns the markdown and
  the SHA-256 of its bytes; `PUT /api/vaults/:id/note/source {"path", "content",
  "baseHash"}` writes only if the file still has that hash (`baseHash: null` creates a
  note that mustn't exist), else 409 and nothing is written. The write is atomic (a
  hidden temporary file renamed over the note, keeping its permissions), the note is
  indexed before the answer, and your saves aren't recorded as changes of an agent
  turn running in the vault.
- **Changed on disk** (Obsidian, Syncthing, an agent): with nothing unsaved the editor
  takes the new version. With unsaved text it stops saving and shows the conflict in
  place, red on disk and green yours, with **Keep mine** / **Use disk** on each
  change, then **Save this version** (saved over the disk version) or **Use the
  disk version**. A note deleted meanwhile can be saved again. An editor with
  unsaved work or a conflict stays in memory, so going back to the note finds it.
- **Wikilinks:** typing `[[` (or `![[`) and a few letters lists notes and files from
  the index (the quick switcher's match); Enter writes the shortest unambiguous
  target, as Obsidian does, and the closing `]]`.
- **Images:** paste or drop an image, or use **Image** (the photo library or camera
  on a phone), and it is added to `assets/` and linked where the cursor was
  (`![[Pasted image 20261113101500.png]]`, named by time as Obsidian does; dropped and
  chosen files keep their names). `POST /api/vaults/:id/assets?name=` with the bytes
  as the body takes PNG, JPEG, GIF, WebP, AVIF and BMP up to 20 MB (not SVG, which
  can carry scripts), never replaces a file (`name 1.png`, `name 2.png`…), and
  indexes it before answering.
- **New note** (**+** in the vault pane): a title, a folder (the open note's by
  default) and a template. Templates are the notes in the vault's **template
  folder**, set per vault in Settings (`PATCH /api/vaults/:id {"templateFolder"}`);
  `{{title}}`, `{{date}}`, `{{time}}`, `{{date:dddd D MMMM}}` and `{{time:h:mm a}}`
  are filled in with moment.js formats, as Obsidian's core Templates plugin does.
  The note opens in the editor; a name that's taken offers the existing note.
- **Delete** (in the note header) moves the note to `.trash/` at the top of the vault,
  as Obsidian's "Move to Obsidian trash" does, so it can be got back (`Coffee 1.md`
  when the trash already has one). The dialog says how many notes link to it. Text
  still being typed is saved first, so it goes to the trash too. `DELETE
  /api/vaults/:id/note?path=&hash=` is hash-checked like saves (409 if the note
  changed since you looked), unindexes the note before answering, and isn't recorded
  against a running agent turn.
- **Tags pane** (the vault pane's **Tags**, on desktop and in the phone drawer):
  frontmatter tags nested by `/`, each counting its notes plus those of the tags
  under it; a filter box, and folding. A tag opens search filtered to it.
- Phones get 16px text (no zoom on focus), sentence capitals and spelling.

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
- **Codex**: your installed `codex` (0.166 or later), with your own login,
  `~/.codex/config.toml`, skills and MCP servers, run through `codex app-server`
  (JSON-RPC over stdio, as Codex's IDE extension uses it). Each thread is a Codex
  thread in its working folder; one `codex app-server` serves it while the thread is
  open (closed 5 minutes after it goes idle, and with the app), and a later message,
  even after a restart, resumes the thread. Pick the model in the thread's header
  (Codex's own list, without its hidden models).
  **Approvals:** every thread runs in Codex's read-only sandbox with the `on-request`
  approval policy. Commands run inside the sandbox without asking (they can read
  anywhere, but not write or reach the network); a patch, or a command that needs
  more than the sandbox, comes to the app, which answers from the agent's autonomy or
  asks you (patches show their diff). A patch that adds a file that doesn't exist yet
  is *create*, anything else *edit*; a patch touching several files takes the
  strictest of them, and files outside the working folders always ask. Codex's web
  search can't ask first, so it is on only when the agent allows the web. Approving
  answers `accept` for that one call, never "for the session". Questions come from
  Codex's `request_user_input` tool (turned on in default mode with
  `features.default_mode_request_user_input`).
  The rules and the agent's instructions are Codex's developer instructions; Codex
  reads `AGENTS.md` itself (in the folder, and above it up to its git repository), so
  that isn't sent. Both are fixed when a Codex thread starts or resumes, so a change
  to them, or a renewed vault-tools token, restarts the app-server and resumes the
  thread before the next turn. The vault tools are an MCP server (`wiki_agents`) in
  the thread's config with `bearer_token_env_var`: the token is only in the
  app-server's environment, never on its command line or in Codex's config.
  Usage is reported per turn, without a cost. Stop asks Codex to stop the turn and
  waits up to 5 s for it to confirm, otherwise closes the app-server (the next message
  resumes the thread); a crash fails the turn with the reason. A running Codex turn
  can't survive an app restart, so it is closed as interrupted.
- **Replay** is for tests only: the integration tests use it, and the server adds it
  only with `WIKI_AGENTS_TEST_HOOKS=true` (the Playwright flows). It plays recorded
  turns and spends no tokens; the message picks the
  recording by keyword (`providers/replay/transcripts.ts`): *edit* proposes an edit
  to `Replay note.md` in the thread's folder and, once you apply it, really appends a
  line (creating the note if needed), so change review and undo can be tried for free;
  *question* (or *ask*) asks a question, *plan* reports a plan step by step and then
  asks where to file the result, *long* streams slowly (for trying Stop and
  reloads), *fail* fails, and anything else gives a plain answer.
- A thread whose provider the app no longer runs (a replay thread from before replay
  became test-only, say) can still be read and marked done; a new message fails its
  turn saying the provider isn't available.

- `POST /api/vaults/:id/threads` creates a thread; `POST /api/threads/:id/messages`
  starts a turn (409 while one runs); `POST /api/threads/:id/interrupt` stops it;
  `POST /api/threads/:id/requests/:requestId` answers an approval or question.
- **Mark done** (in the thread's header) moves an idle thread to the collapsed
  **done** group at the bottom of the list (`POST /api/threads/:id/done`; 409 while a
  turn runs or waits for you). **Reopen** moves it back (`POST /api/threads/:id/reopen`),
  and so does sending it a message.
- **Plans**: when the agent keeps a plan (Claude Code's `TodoWrite`, OpenCode's
  `todowrite`, Codex's plan updates) the turn shows it as a checklist instead of a
  tool call, updated in place (`plan.updated` events; the latest is kept in
  `turns.plan`). The thread list shows the running turn's progress (`2/5`); without a
  plan there is only the working indicator. As of 2026-11-14 only OpenCode sends
  plans, and only with `WIKI_AGENTS_OPENCODE_TODO=true`: Claude Code 2.1.321 has no
  todo tool in SDK mode, and Codex 0.167.1 has no `update_plan`.
- **Running** (`/inbox/running`, a tab next to the inbox)
  lists every thread in every vault and project that is waiting for you, working (with
  its plan progress and current step), or stopped: its last turn failed, or ended
  without you pressing Stop (a restart, the provider giving up), with the reason.
  Stopped threads stay until you send them a message or **Mark done**, for at most a
  week. `GET /api/active-threads` lists them; the `all-threads` topic on the event
  stream keeps the page current (the per-vault list follows `vault-threads`). The page
  follows that topic only while it is shown, and the tab has no count yet.
  There is no task queue: a background task is a thread, and threads for the same
  agent run side by side.
- Each thread has a **ThreadActor** (`features/threads/thread-actor.ts`): one mailbox
  and one fiber, so sends, interrupts, answers, and provider events never race. It
  writes to SQLite before it publishes, and rebuilds its state from SQLite.
- Event streams end when the server starts shutting down (browsers reconnect and
  resume), so a restart doesn't wait for them.
- **One event stream per tab.** `GET /events` starts with a connection id; each store
  follows a topic on it with `POST /api/events/:connectionId/subscriptions
  {"subscriptionId", "topic"}` and stops with `DELETE …/subscriptions/:subscriptionId`.
  Topics: `inbox`, `all-threads`, `vault` and `vault-threads` (with `vaultId`), and
  `thread` (with `threadId` and `after`). Each message is wrapped as
  `{"type": "message", "subscriptionId", "message"}`, with the topic's own message
  inside. Over HTTP/1.1 browsers allow six connections per host across all tabs, and a
  stream per store (up to five per tab) left a second tab hanging
  (`apps/web/e2e/connection-cap.spec.ts`). The client side is `apps/web/src/lib/api/sse.ts`;
  a reconnect gets a new connection id and subscribes everything again.
- The `thread` topic sends the thread's stored events after `after`, then live ones;
  after a reconnect the client subscribes with the last seq it has, so a reload or a
  dropped connection mid-turn misses nothing and repeats nothing. `GET /events` is the
  only event stream; the older single-topic ones were removed (any other path under
  `/events` is a 404). To watch a topic with curl, open `/events`, then POST a
  subscription with the connection id it sends first.
- The web app follows `inbox` and `all-threads` on every page, so the header shows
  the unread count and, while threads are at work, a running indicator (how many are
  working, or how many wait for you) that links to the Running tab.
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
`vault_recent_changes`, and `vault_status`, plus the schedule tools (see Schedules and
the inbox). Arguments are strict. Search is FTS5
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
three views, switched with **Overview | Threads | Diff**: the overview (the default,
`/projects/<id>`), and the project's threads with the open one in the middle and
the project beside it (`/projects/<id>/threads`), where **New thread here** and
**Open** go, and the diff from git for review (`/projects/<id>/diff`, below). The
Projects page shows only project threads; threads without a
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
- **Diff** (`/projects/<id>/diff`, also **Review the diff** under changed files)
  shows each working directory's changes from git, compared with `HEAD`: staged and
  unstaged together, untracked (not ignored) files as new, renames detected, binary
  files listed without a diff. `GET /api/projects/:id/diff` cuts each file's diff
  (1,500 lines / 120 KB; files past 4 MB of diffs in total come without theirs);
  **Show the whole diff** asks `GET /api/projects/:id/diff/file?directory=…&path=…`
  (20,000 lines / 2 MB, only inside a working directory; past that, use lazygit).
  A folder outside git lists its changed files (against the baseline) with no diff.
  The app only reads git (`execFile`, `-C`, no pager, colour, external diff or
  textconv, literal pathspecs, `GIT_OPTIONAL_LOCKS=0`); it never stages, commits or
  restores. Search with `/`, `n`/`N` (desktop). Click (tap) a line to comment,
  shift-click or tap another line for a range; comments are drafts in this
  browser (`localStorage`) until **Send to thread** posts them as one message
  (`path:line`, the quoted lines, the comment, grouped by file) to one of the
  project's open threads or a new one. The diff refreshes when one of the
  project's turns ends, and with **Refresh**. On a phone: the file list, then one
  file at a time.
- **Ignore** in a file's header sets it aside in that project's reviews (local
  config and other changes you never merge): it leaves the file list, the totals
  and search, and waits under **Ignored · n** in its folder, where it can be shown,
  reviewed, commented on and brought back with **Stop ignoring**. The list is kept
  on the server per project and working directory, by path, until you stop
  ignoring it (`POST /api/projects/:id/diff/ignored {"directory", "path"}`,
  `DELETE …/diff/ignored?directory=…&path=…`). It doesn't change git or the
  overview's changed-file list. Agents read the list with the
  `project_ignored_files` MCP tool (current at each call), and a project's
  instructions tell them to check it before staging or committing and leave those
  files out unless you name them. It is guidance: command approvals are what stop
  a commit.
- Undo code changes with lazygit/git; changes a project thread makes to the shared
  vault get change review (below).
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
  and `autonomy` per action (`read`, `create`, `edit`, `commands`,
  `web`: `allow`, `ask`, or `deny`; `always` and `never` work too). Anything left out
  reads freely and asks for the rest. Unknown keys are errors, so typos can't pass.
  `concurrency`, from before the task queue was dropped, is still accepted and ignored.
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
  Codex gets them as developer instructions and the autonomy through its sandbox and
  approval requests (see Codex, above).
- Pick a thread's agent in its header; it applies from the next message.
  The Agents tab (phone) or the right pane's Agents switch (desktop) lists agents
  with what they are doing in this vault, and shows each one's autonomy as written
  and as each provider enforces it.
- **Editing in the app**: **New agent** and **Edit** (on an agent's detail) open
  `/agents/edit`; the rules files are listed under the agents, with **New rules file**
  (`/agents/rules`). The agent form has name, description, provider and model (from
  the provider's list, `GET /api/providers/:id/models`), autonomy per action, knowledge
  sources and the instructions; **What each provider enforces** shows
  the saved version as each provider applies it. Saves are explicit (**Save**), and
  leaving with unsaved changes asks first.
  - **Only what the loader accepts**: the server builds the file and parses it exactly
    as the loader does, so the app never writes a file it would refuse. A refusal is
    a 422 with one `field: problem` per line, shown under its field.
  - **Edited in place**: an existing file's frontmatter is changed where it is, so
    comments, key order and keys the form doesn't show (`tags`) stay; settings at
    their defaults (no provider, model, description or sources) are removed.
  - **Hash-checked and atomic**, like note saves: `GET` returns the SHA-256 of the
    file, a save or delete sends it back (`baseHash`, or `hash` for a delete; `null`
    creates a file that mustn't exist), and anything else gets a 409 and writes
    nothing. The file is written to a hidden temporary file beside it and renamed over
    it (or hard-linked into place when new, so a file created meanwhile is never
    replaced). A 409 shows what is on disk against yours: field by field for an
    agent, a line diff for rules, with **Save mine over it** or **Use the disk
    version**.
  - **Deleting** moves the file to `.trash/agents/` or `.trash/rules/` in the config
    directory (`researcher 1.md` when the name is taken). Threads with a deleted
    agent keep their history and fail their next turn until they get another agent.
  - The catalog reloads before a save answers, so threads use the change from their
    next message.
- **Knowledge sources** (`sources`) limit what the agent may look things up in:
  `vault` (whichever vault the thread works in), `web`, and registered vaults by name,
  whole or some folders (`- vault: obsidian-vault` with `folders: [1-Active,
  3-Resources]`). No sources means no limits. Otherwise the vault tools reach only
  the listed vaults and folders: search and recent changes are filtered in SQL,
  backlinks, related notes and link resolution leave other notes out, and a note
  outside is refused with the agent's folders named; a vault not listed refuses every
  vault tool, while `vault_status` still answers. Without `web` among them, the web is
  denied whatever the autonomy says (the agent screen notes it). Vaults are named, not
  by id, because the config is synced between machines; a source naming a vault that
  isn't registered here is kept and shown as such. Sources limit the vault tools only:
  a provider's own file tools follow autonomy and the project's folders.
- `GET /api/agents`, `GET /api/agents/:id`, `PUT /api/agents/:id`
  (`{"agent": {...}, "baseHash"}`), `DELETE /api/agents/:id?hash=`, `GET`/`PUT`/`DELETE`
  `/api/rules/:id` (`{"content", "baseHash"}`), `PUT /api/threads/:id/agent`
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

#### Codex tests and recordings

The Codex adapter is tested the same way: real conversations recorded through the
real adapter and `codex app-server` into `apps/server/tests/fixtures/codex/*.json`
(Codex's notifications and requests during each turn, and what the adapter
answered), played back by a scripted app-server (`fake-app-server.ts`) that answers
the handshake, threads and models itself and checks the adapter answers each request
as it did when recorded. Scenarios: as for Claude Code, plus a command approved
outside the sandbox. Output of commands that read outside the vault (your skills,
say) is left out of the fixtures. To record them again, on gpt-5.6-luna unless
`--model` says otherwise (this spends a little of your plan or credit):

```bash
nix develop -c npm run record:codex -w @wiki-agents/server -- [scenario...]
```

One opt-in test runs a real turn on the installed Codex:
`WIKI_AGENTS_LIVE_CODEX=1 nix develop -c npx vitest run tests/live/codex.live.test.ts`
(in `apps/server`). After upgrading Codex, compare `providers/codex/protocol.ts` with
`codex app-server generate-ts --out <dir>`.

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

### Schedules and the inbox

**Inbox** (header link, with the unread count) is one list across vaults, projects
and agents, live over the event stream's `inbox` topic: reminders, scheduled prompts' answers
(markdown, linking to the run's thread), approvals and questions waiting for you
(done once answered), and each thread's latest turn result (done when you send the
thread another message). Items can be snoozed (they come back unread), dismissed or
marked done; looking at the inbox marks them read.

**Schedules** (`/inbox/schedules`, or an agent's `schedule_*` tools) are of two kinds:

- a **reminder**: a message at a time, optionally linking a note or a thread; no
  model runs.
- a **scheduled prompt**: a prompt given to an agent at a time, in the schedule's own
  thread, one turn per run. It runs **unattended**: an approval is denied and a
  question answered "nobody is available" instead of waiting, each with a notice, and
  the inbox item lists what it couldn't do. The agent's final answer is the inbox
  item.

Times are local times in an IANA timezone (`WIKI_AGENTS_TIMEZONE`, default
`Pacific/Auckland`): once, every day, or on chosen weekdays. A time skipped when
daylight saving starts fires that much later (02:30 becomes 03:30); a time repeated
when it ends fires once, the first time. Every schedule shows its next date, time and
timezone.

The scheduler is an Effect fiber on the server's clock (`features/schedules/`).
Each occurrence is a `schedule_runs` row, unique per schedule and time, written in
the same transaction as its inbox item and the schedule's next time, so an
occurrence never fires twice, even across restarts. Times missed while the server
was off fold into one: a reminder arrives once, marked late; a scheduled prompt
follows its missed policy (`same-day` by default: run at startup if it is still the
same local day, otherwise record it as missed in the inbox; or `always`, `skip`).
One run per schedule at a time: a time that comes while a run is going is recorded
as skipped. A failed run is an inbox item and is never rerun automatically (**Run
now** starts a new one); three failures in a row pause the schedule and say so. Runs
show their status and cost.

Inbox items are delivered through a delivery outbox (`inbox_deliveries`), queued in
the same transaction as the item and sent by a worker per channel (`in-app`, the
live stream, and `web-push`, below), retried up to five times with backoff; failures
show on the item, and so does where it went or why it was skipped. A result is
stored before it is delivered, so a retry never reruns the turn.

### Notifications (Web Push)

**Notifications** (`/inbox/notifications`) sends inbox items to your devices with the
app closed. **Enable notifications** asks the browser's permission, subscribes it
through the service worker (`src/service-worker/index.ts`) and adds it as a device;
**Send test** sends one now and says what the push service made of it; **Remove** and
**Turn off here** stop them. Tapping a notification opens `/inbox?item=<id>`, with
the item outlined.

- Browsers allow it only on a secure origin: `http://127.0.0.1`/`localhost` on this
  computer, otherwise HTTPS. A phone needs the app's HTTPS address: serve it on your
  tailnet with `tailscale serve` (Run as a service, below). iPhone and iPad allow it
  only from the app added to the Home Screen (the app has a manifest and icons for that).
- Each device is one push subscription (`push_devices`). The push service answering
  404 or 410 removes the device; five other failures in a row disable it until it
  subscribes again. Each item's delivery to each device is recorded
  (`push_deliveries`), so a retry only goes to the devices that didn't get it.
- **What notifies you:** per group (reminders, agents waiting for you, scheduled
  prompts, turns), *notify at once*, *in the morning digest*, or *inbox only*
  (turns default to inbox only). The digest (default 08:00, in
  `WIKI_AGENTS_TIMEZONE`) is an inbox item listing what was held since the last one
  and still open. **Mute** stops all notifications; the inbox keeps everything.
  **Private previews** say only what kind of item arrived, never its text.
- **VAPID keys:** made on first start and kept in the database, or read from
  `WIKI_AGENTS_VAPID_KEYS_FILE` (`{"publicKey": "...", "privateKey": "..."}`,
  base64url, e.g. `npx web-push generate-vapid-keys --json`) to keep them in service
  secrets. Changing keys invalidates every subscription: devices must enable again.
- Sending: `web-push` signs and encrypts (aes128gcm) and the server sends with
  `fetch`, with a 24 h TTL; reminders and requests are `Urgency: high`. A push
  service accepting a notification doesn't prove the device showed it.
- The browser picks the push service: Chrome, Edge and Brave use Google's (FCM;
  in Brave turn on "Use Google services for push messaging"), Firefox Mozilla's,
  Safari Apple's. Payloads are end-to-end encrypted; the service sees only metadata.
  Chromium builds without Google services can't subscribe ("push service error").

The schedule tools (`schedule_create`, `schedule_list`, `schedule_update`,
`schedule_pause`, `schedule_resume`, `schedule_delete`, `schedule_run_now`) call
the same use cases as the API, follow the agent's `read` autonomy like the vault
tools, and show a receipt in the conversation (kind, next time and timezone, agent,
prompt, destination, and an edit link). They tell the agent to ask about genuinely
ambiguous times first. A scheduled prompt made in a thread defaults to that thread's
vault, project and agent.

End-to-end tests move the schedules' clock with `POST /api/test/clock`
(`{ "advanceMs": … }`), served only with `WIKI_AGENTS_TEST_HOOKS=true` (which also adds
the replay provider).

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
| `WIKI_AGENTS_OPENCODE_TODO` | `false`; `true` turns on OpenCode's experimental `todowrite` tool (`experimental.todo`, added to any `OPENCODE_CONFIG_CONTENT`) for the app's OpenCode server, so OpenCode threads show plans. It adds tool calls to multi-step turns; restart the app after changing it |
| `WIKI_AGENTS_CLAUDE` | `claude` (looked up on `PATH`) |
| `WIKI_AGENTS_CONFIG_DIR` | `$XDG_CONFIG_HOME/wiki-agents` (rules and agents) |
| `WIKI_AGENTS_TIMEZONE` | `Pacific/Auckland`: the timezone new schedules use unless they say otherwise |
| `WIKI_AGENTS_TEST_HOOKS` | `false`; `true` serves `POST /api/test/clock` and adds the replay provider, for end-to-end tests only |
| `WIKI_AGENTS_VAPID_KEYS_FILE` | unset: Web Push keys are made on first start and kept in the database |
| `WIKI_AGENTS_VAPID_SUBJECT` | `https://github.com/alex-bartleynees/wiki-llm-agents`: the contact push services see (`mailto:` or `https:`) |
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
package; default: `opencode` from your user profile, which must be 2.2.x), `opencodeTodo`
(default off; sets `WIKI_AGENTS_OPENCODE_TODO`), `claudeCode`
(a package; default: `claude` from your user profile, which must be 2.1.x), `codex`
(a package; default: `codex` from your user profile, 0.166 or later),
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
- **From a phone: `tailscale serve`.** Keep the app on loopback and let Tailscale
  give it HTTPS on your tailnet. Turn on MagicDNS and HTTPS Certificates in the
  Tailscale admin console once, then on the host:

  ```sh
  sudo tailscale serve --bg 4320      # https://<host>.<tailnet>.ts.net → 127.0.0.1:4320
  tailscale serve status              # what is served; `sudo tailscale serve reset` stops it
  ```

  Open `https://<host>.<tailnet>.ts.net` on any device on the tailnet. HTTPS makes it a
  secure origin, so notifications work there (on iPhone, add it to the Home Screen
  first). Only devices on your tailnet can reach it; the app still has no login, so
  don't share the tailnet or the machine without adding ACLs or a login.
- **The real vault.** Agent edits to the vault's notes are listed on each turn with a
  diff and undo (Change review, above); they follow each agent's autonomy, which asks
  before edits by default. Files other than notes, and anything outside the vault,
  have no in-app undo: use git, Syncthing versioning or backups.
