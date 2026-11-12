import type { Project } from "@wiki-agents/contracts/projects/model";
import type { Instruction } from "../providers/port.js";

/** Where a project's threads run. */
export const mainDirectory = (project: Project) => project.workingDirectories[0]!;

/** The folders a project's agent may reach without asking: its working directories and the shared vault. */
export const projectRoots = (project: Project, vaultRoot: string): ReadonlyArray<string> => [...project.workingDirectories, vaultRoot];

/** Tells a project's agent where it works and where the notes are. */
export const projectInstruction = (project: Project, vaultRoot: string): Instruction => ({
  source: "project",
  title: `Project ${project.name}`,
  path: mainDirectory(project),
  text: [
    `You are working on the project "${project.name}".`,
    `Working directories (the first is the current one): ${project.workingDirectories.join(", ")}.`,
    `Shared vault: ${vaultRoot}. Use the vault MCP tools for notes.`,
    ...(project.notesFolder === null ? [] : [`This project's notes are in the vault folder ${project.notesFolder}.`]),
    "Working outside these folders and the shared vault needs the user's approval.",
    "The user sets some files aside in review (local changes they never merge). Before staging or committing, call the project_ignored_files tool and leave those files out unless the user names them.",
  ].join("\n"),
});
