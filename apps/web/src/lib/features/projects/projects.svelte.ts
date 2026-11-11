import type { Project } from "@wiki-agents/contracts/projects/model";
import { errorMessage } from "#lib/api/client.ts";
import { archiveProject, listProjects, restoreProject } from "./api.ts";

/** The selected project, remembered on this device. */
const SELECTED_KEY = "wiki-agents:project";

const stored = () => {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
};

/**
 * Registered projects and the one selected; none selected means the vault's own threads.
 * Archived projects are listed but can't be selected.
 */
class ProjectsStore {
  list = $state<ReadonlyArray<Project>>([]);
  selectedId = $state<string | null>(null);
  error = $state<string | null>(null);

  /** The projects the switchers offer. */
  get active() {
    return this.list.filter((project) => project.archivedAt === null);
  }

  get archived() {
    return this.list.filter((project) => project.archivedAt !== null);
  }

  get selected() {
    return this.list.find((project) => project.id === this.selectedId) ?? null;
  }

  select(id: string | null) {
    this.selectedId = id;
    try {
      if (id === null) localStorage.removeItem(SELECTED_KEY);
      else localStorage.setItem(SELECTED_KEY, id);
    } catch {
      // Private mode or full storage: the selection just won't be remembered.
    }
  }

  async load() {
    try {
      this.list = (await listProjects()).projects;
      const saved = stored();
      if (this.selectedId === null && this.active.some((project) => project.id === saved)) this.selectedId = saved;
      if (this.selectedId !== null && !this.active.some((project) => project.id === this.selectedId)) this.select(null);
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error, "Could not load projects");
    }
  }

  /** Archives the project; the threads pane leaves it if it was selected. */
  async archive(id: string) {
    this.replace((await archiveProject(id)).project);
    if (this.selectedId === id) this.select(null);
  }

  async restore(id: string) {
    this.replace((await restoreProject(id)).project);
  }

  private replace(project: Project) {
    this.list = this.list.map((existing) => (existing.id === project.id ? project : existing));
  }
}

export const projects = new ProjectsStore();
