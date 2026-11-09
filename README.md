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
| `nix develop -c npm test` | All tests |
| `nix develop -c npm run check` | Type checks (tsc, svelte-check) |
| `nix develop -c npm run build` | Build contracts, server, and web app |
| `nix build` | Package to `result/bin/wiki-agents` |
| `nix develop -c npm run db:generate -w @wiki-agents/server` | Generate a Drizzle migration after changing a `table.ts` |

Gate before every commit: `npm test`, `npm run check`, `npm run build`, `git diff --check`.

## Vaults

Register a vault on the settings screen (⚙ in the vault pane), with
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

The right-hand pane (the Chat tab on phone) holds the vault's agent threads. For now
the only provider is **replay**, which plays recorded turns and spends no tokens; the
message picks the recording by keyword (`providers/replay/transcripts.ts`): *edit*
asks for an approval, *question* (or *ask*) asks a question, *long* streams slowly
(for trying Stop and reloads), *fail* fails, and anything else gives a plain answer.

- `POST /api/vaults/:id/threads` creates a thread; `POST /api/threads/:id/messages`
  starts a turn (409 while one runs); `POST /api/threads/:id/interrupt` stops it;
  `POST /api/threads/:id/requests/:requestId` answers an approval or question.
- Each thread has a **ThreadActor** (`features/threads/thread-actor.ts`): one mailbox
  and one fiber, so sends, interrupts, answers, and provider events never race. It
  writes to SQLite before it publishes, and rebuilds its state from SQLite.
- `GET /events/threads/:id?after=<seq>` streams the thread's stored events after
  `seq`, then live ones; reconnecting browsers send `Last-Event-ID`, so a reload or a
  dropped connection mid-turn misses nothing and repeats nothing.
- At startup the server wakes threads left mid-turn: a turn that never reached the
  provider is started, one waiting on an approval or question stays answerable, and
  one that was streaming is closed as interrupted.

The app only reads vaults until change review exists (slice 8). Dot-folders
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
