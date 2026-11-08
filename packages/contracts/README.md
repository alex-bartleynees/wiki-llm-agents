# @wiki-agents/contracts

Effect Schemas for everything that crosses the wire between `apps/server` and
`apps/web`. Depends on `effect` only.

Layout mirrors the server's features: `<feature>/<operation>/request.ts` and
`response.ts` per HTTP operation, `<feature>/model.ts` for shared nested concepts,
and `<feature>/event.ts` for SSE events. The operation's `endpoint.ts` lives at the
same path under `apps/server/src/features/`.

Imports resolve to `src/` under the `source` condition (dev, tests, Vite) and to
`dist/` otherwise (production).
