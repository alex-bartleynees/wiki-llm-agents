# Git module boundary

All server code that runs Git lives in `apps/server/src/features/projects/git/`. Only the projects feature imports it, through `index.ts`. Threads create and remove worktrees through `projects/worktrees.ts`.

- The module takes directories, refs and paths. It knows nothing about projects, threads or stored records, and imports only itself, `shared/` and contracts.
- Project policy stays in use cases: which directories are allowed, whether a review is stale, when a branch may be deleted, diff limits, and which generated trees are skipped. Callers pass limits and skipped names in.
- It fails with `GitRefused` (Git said no; the message is for the user) or `GitFailed` (it could not be run or read). Project endpoints map both. `worktrees.ts` translates them to `WorktreeRefused` and `ProjectFilesError`, so threads don't depend on Git errors.
- `commitExactly` owns adding new files, committing only the named paths, and taking added files back out of the index when the commit fails.

`npm run lint:git-boundary`, part of `npm run check`, enforces the imports and refuses launching a literal `git` elsewhere in server source. Tests are exempt, because they set up real repositories.

## Not an adapter

There is one version control system, and the guarantees are Git's own: `commit --only`, reflog identity, ref transactions. A generic interface designed now would hide them or copy Git's shape. A second system would instead sit beside this module, behind narrow capabilities: change review, commit, publish and isolated workspaces.

It is not a feature, since it has no operations or tables, and not in `shared/`, since only projects uses it. Move it to `shared/` when a second feature needs Git directly.

## Unchanged behaviour

Short reads report a Git that can't run as a null exit code, so a folder is then treated as outside Git and scanned as plain files. Commit and push report it as an error. The three ways of running Git stay separate: short reads, time-limited writes in their own process group, and a two-way ref transaction.
