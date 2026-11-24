# Local skill installation state

The selected library is the source of truth. The server keeps the selected absolute paths in `skills-settings.json` in its data directory, which is host-local even when the library or config directory is synced.

The app records ownership, the installed digest and one rollback version per skill under `skill-installs/<SHA-256 of canonical destination>/<leaf skill>/` in host-local app data. A digest covers relative paths, bytes and modes. Preview returns a token bound to the reviewed versions and action. Apply rebuilds the review from disk before it accepts that token. A save to the library changes only `SKILL.md`.

The installer journals the operation in app data, writes and verifies a staged copy in a randomly named hidden workspace beside the install, moves the old directory into that workspace, then renames the staged copy into place. The state record commits the operation. All live renames stay on the destination filesystem. A failed or interrupted operation is recovered from the journal and the workspace:

- The operation activated if the staged copy has left the workspace, the old directory matches the reviewed digest and the live path matches the intended digest. Recovery commits it.
- Otherwise recovery moves the old directory back, including any edit made as it moved. If the live path is occupied, both copies and the journal are left for manual inspection.
- A committed operation only needs its workspace removed, so recovery leaves later edits to the live bundle alone.

Publication uses a plain rename after checking that the path is vacant. A directory rename cannot replace a file, a link or a non-empty directory, so a concurrent creation can lose at most an empty directory. This needs no native helper. Bundle digests identify content, and the installer does not track device or inode numbers. Use one wiki-agents server per destination filesystem, and keep install destinations local to that host.

Discovery walks group folders until it reaches a bundle. The library-relative folder identifies the source, and provider destinations still use its leaf name. An installed bundle reserves that name for its recorded source path.

Configured destinations that resolve to the same directory share one ownership record and display all provider labels. Settings keep the entered alias and its resolved path so a link retarget requires review. Preview reports aliases and overlaps before any settings are written.

External installs are read-only. A directory symlink identifies its exact library folder. Copies must be valid skill bundles. An identical copy must match one library source, and a differing same-name copy requires a single candidate in the library. Ambiguous or unrelated entries remain unmanaged conflicts.

Detail requests only inspect state. An explicit Recover install action reconciles a pending operation. An occupied directory without a management record remains external.

Cleanup makes directories inside the workspace and obsolete rollback bundles writable when needed for removal.
