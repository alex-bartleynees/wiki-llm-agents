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
