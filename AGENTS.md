# Agent instructions

Read `README.md` first. Design decisions are in the user's vault at
`~/Documents/obsidian-vault/1-Active/Wiki-LLM-Agents-App/`; read
`Code Organisation.md` and `Implementation Plan.md` there before adding a feature.

## Rules

- Run everything through Nix: `nix develop -c <command>`. There is no global Node.
- Vertical slices with strict REPR. An HTTP operation is split across two packages
  at the same path:
  - `packages/contracts/src/<feature>/<operation>/request.ts` and `response.ts`
  - `apps/server/src/features/<feature>/<operation>/endpoint.ts` (plus
    `use-case.ts` only when there is real orchestration)
  Copy `vaults/list-vaults` as the template.
- `packages/contracts` depends on `effect` only. `apps/web` and `apps/server`
  never import each other.
- Endpoints decode the request, call a use case or repository, map errors, and
  encode the response. No SQL or file IO in endpoints.
- A feature never imports another feature's adapter (`sqlite-repository.ts`).
- Each feature owns its tables in `features/<feature>/table.ts`; generate a
  migration with `npm run db:generate -w @wiki-agents/server`; never edit
  generated SQL by hand. For what Drizzle can't declare (FTS5 virtual tables), write
  a custom migration: `npx drizzle-kit generate --custom --name <name>` in
  `apps/server`.
- Code used by several features lives in `apps/server/src/shared/` (`vault/` path
  guard and walker, `markdown/` parsing and link resolution); features read each
  other's data through ports (`indexing/vault-index.ts`), never their adapters.
- In the web app use `#lib/...` imports (SvelteKit 3), not `$lib`.
- Every screen must work at desktop (1440px) and phone (390px) widths.
- Tests: integration tests boot the real HTTP app with `TestApp`
  (`apps/server/tests/integration/infrastructure/test-app.ts`). No sleeps or
  polling in tests.
- Before finishing: `npm test`, `npm run check`, `npm run build`, `git diff --check`.
- After `package-lock.json` changes, update `npmDepsHash` in `nix/package.nix`
  (`nix run nixpkgs#prefetch-npm-deps package-lock.json`) and check `nix build`.
