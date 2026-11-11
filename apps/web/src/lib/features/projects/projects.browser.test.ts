import type { Project } from "@wiki-agents/contracts/projects/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The projects store with real Svelte state and localStorage; only the API is a stand-in. */

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
}));
vi.mock("./api.ts", () => api);

const { projects } = await import("./projects.svelte.ts");

const project = (id: string, archivedAt: number | null = null): Project => ({
  id,
  name: id,
  vaultId: "v1",
  workingDirectories: [`/work/${id}`],
  notesFolder: null,
  archivedAt,
});

beforeEach(() => {
  localStorage.clear();
  projects.list = [];
  projects.selectedId = null;
  api.listProjects.mockReset();
  api.archiveProject.mockReset();
  api.restoreProject.mockReset();
});

describe("archived projects", () => {
  it("are listed apart and never reselected from the remembered choice", async () => {
    localStorage.setItem("wiki-agents:project", "old");
    api.listProjects.mockResolvedValue({ projects: [project("app"), project("old", 1)] });
    await projects.load();
    expect(projects.active.map((p) => p.id)).toEqual(["app"]);
    expect(projects.archived.map((p) => p.id)).toEqual(["old"]);
    expect(projects.selectedId).toBeNull();
  });

  it("leave the threads pane when archived, and come back to the switchers when restored", async () => {
    api.listProjects.mockResolvedValue({ projects: [project("app"), project("other")] });
    await projects.load();
    projects.select("app");
    api.archiveProject.mockResolvedValue({ project: project("app", 5) });
    await projects.archive("app");
    expect(projects.selectedId).toBeNull();
    expect(localStorage.getItem("wiki-agents:project")).toBeNull();
    expect(projects.active.map((p) => p.id)).toEqual(["other"]);

    api.restoreProject.mockResolvedValue({ project: project("app") });
    await projects.restore("app");
    expect(projects.active.map((p) => p.id)).toEqual(["app", "other"]);
  });

  it("drops a selection whose project was archived elsewhere", async () => {
    api.listProjects.mockResolvedValue({ projects: [project("app")] });
    await projects.load();
    projects.select("app");
    api.listProjects.mockResolvedValue({ projects: [project("app", 7)] });
    await projects.load();
    expect(projects.selectedId).toBeNull();
  });
});
