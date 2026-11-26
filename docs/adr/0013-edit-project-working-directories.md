# Editing a project's working directories

A project's working directories can change after registration:
`POST /api/projects/:projectId/working-directories {"path"}` adds one and
`DELETE /api/projects/:projectId/working-directories?path=` removes one
(`features/projects/add-working-directory`, `remove-working-directory`). Use this to
give agents another repository for a while, then take that access away.

## Access is full, like registration

An added directory works like one chosen at registration: agents may write there
within their autonomy. Read-only reference directories, which the vault's Slice 15d
plan prefers, were deferred on 2026-11-26 to keep this change small. If they are
added later, use the attachment-folder path: reads are allowed and writes ask.

## The main directory stays

Only directories after the first can be removed. Threads start in the main
directory, worktrees are checked out from it, and project MCP connections run in it.
Changing the main directory would change the `cwd` of sessions that are already
open.

## Running threads pick changes up on their next turn

`ThreadActor.currentSetup` reads the project again for every turn and builds
`projectRoots` and the project instruction from the current list. It does not use the
list the actor started with. If the read fails, the turn fails instead of falling
back to the old list, so a removed directory can't come back. No adapter needed
changes:

- **Claude Code** restarts its process when the appended prompt changes. The project
  instruction lists the directories, so `additionalDirectories` follows. While the
  process is busy (a turn or background subagents), the restart waits. The
  `PreToolUse` hook already judges file tools against the latest turn's roots, so
  a removed directory asks from the next turn even before the restart.
- **Codex** starts a new app-server when its config key changes, and the sandbox's
  writable roots are part of that key.
- **OpenCode** answers each `external_directory` request once, from the latest
  turn's setup.

A turn that is already running keeps the access it started with.

## Baselines and ignored files

Adding a directory snapshots its files as its baseline. Its existing files are
therefore not reported as created. Removing a directory deletes its baseline and
ignored-file rows in the same transaction. Its files are not reported as deleted, and
adding it again starts clean. Files on disk are never touched.

The repository updates the list inside one SQLite transaction that reads the row
again. Two edits made at the same time therefore can't overwrite each other.

A directory inside or around an existing working directory is refused. Its files
would be counted twice in the changed-file list.
