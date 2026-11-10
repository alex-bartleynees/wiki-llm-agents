import type { Project } from "@wiki-agents/contracts/projects/model";
import { errorMessage } from "#lib/api/client.ts";
import { listProjects } from "./api.ts";

/** The selected project, remembered on this device. */
const SELECTED_KEY = "wiki-agents:project";

const stored = () => {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
};

/** Registered projects and the one selected; none selected means the vault's own threads. */
class ProjectsStore {
  list = $state<ReadonlyArray<Project>>([]);
  selectedId = $state<string | null>(null);
  error = $state<string | null>(null);

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
      if (this.selectedId === null && this.list.some((project) => project.id === saved)) this.selectedId = saved;
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error, "Could not load projects");
    }
  }
}

export const projects = new ProjectsStore();
