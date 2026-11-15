import type { Project, Worktree } from "@wiki-agents/contracts/projects/model";
import type { Instruction } from "../providers/port.js";

/** Where a project's threads run, unless a thread has its own worktree. */
export const mainDirectory = (project: Project) => project.workingDirectories[0]!;

/**
 * A thread's working directories: the project's, with the thread's worktree in place
 * of the main directory, which is then outside the thread like any other folder.
 */
export const threadDirectories = (project: Project, worktree: Worktree | null): ReadonlyArray<string> =>
  worktree === null ? project.workingDirectories : [worktree.directory, ...project.workingDirectories.slice(1)];

/** The folders a project's agent may reach without asking: its working directories and the shared vault. */
export const projectRoots = (directories: ReadonlyArray<string>, vaultRoot: string): ReadonlyArray<string> => [...directories, vaultRoot];

/** Tells a project's agent where it works and where the notes are. */
export const projectInstruction = (project: Project, directories: ReadonlyArray<string>, vaultRoot: string, worktree: Worktree | null): Instruction => ({
  source: "project",
  title: `Project ${project.name}`,
  path: directories[0]!,
  text: [
    `You are working on the project "${project.name}".`,
    `Working directories (the first is the current one): ${directories.join(", ")}.`,
    ...(worktree === null
      ? []
      : [
          `The current directory is this thread's own git worktree, on the branch ${worktree.branch}. The project's main checkout (${mainDirectory(project)}) is outside it; changes there need the user's approval. Commit on ${worktree.branch} only when the user asks; the user merges.`,
        ]),
    `Shared vault: ${vaultRoot}. Use the vault MCP tools for notes.`,
    ...(project.notesFolder === null ? [] : [`This project's notes are in the vault folder ${project.notesFolder}.`]),
    "Working outside these folders and the shared vault needs the user's approval.",
    "The user sets some files aside in review (local changes they never merge). Before staging or committing, call the project_ignored_files tool and leave those files out unless the user names them.",
  ].join("\n"),
});
