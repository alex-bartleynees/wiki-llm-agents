import { asc, eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DbError } from "../../shared/persistence/errors.js";
import { Sqlite } from "../../shared/persistence/sqlite.js";
import { type FileVersion, ProjectRepository } from "./repository.js";
import { projectFiles, projects } from "./table.js";

const columns = {
  id: projects.id,
  name: projects.name,
  vaultId: projects.vaultId,
  workingDirectories: projects.workingDirectories,
  notesFolder: projects.notesFolder,
};

/** Six variables a row, well below SQLite's limit of 32766 per statement. */
const FILES_PER_INSERT = 1000;

export const ProjectRepositoryLive = Layer.effect(
  ProjectRepository,
  Effect.gen(function* () {
    const { db } = yield* Sqlite;
    const query = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new DbError({ cause }) });
    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
    /** In batches: a project can have more files than SQLite allows variables in one statement. */
    const insertFiles = (tx: Tx, projectId: string, baseline: ReadonlyArray<FileVersion>) => {
      for (let start = 0; start < baseline.length; start += FILES_PER_INSERT) {
        tx.insert(projectFiles).values(baseline.slice(start, start + FILES_PER_INSERT).map((file) => ({ projectId, ...file }))).run();
      }
    };

    return ProjectRepository.of({
      list: query(() => db.select(columns).from(projects).orderBy(asc(projects.name), asc(projects.id)).all()),
      find: (id) => query(() => Option.fromNullishOr(db.select(columns).from(projects).where(eq(projects.id, id)).get())),
      insert: (project, baseline, at) =>
        query(() =>
          db.transaction((tx) => {
            tx.insert(projects).values({ ...project, createdAt: new Date(at) }).run();
            insertFiles(tx, project.id, baseline);
          }),
        ),
      baseline: (id) =>
        query(() =>
          db
            .select({ directory: projectFiles.directory, path: projectFiles.path, hash: projectFiles.hash, size: projectFiles.size, modifiedAt: projectFiles.modifiedAt })
            .from(projectFiles)
            .where(eq(projectFiles.projectId, id))
            .all(),
        ),
      replaceBaseline: (id, baseline) =>
        query(() =>
          db.transaction((tx) => {
            tx.delete(projectFiles).where(eq(projectFiles.projectId, id)).run();
            insertFiles(tx, id, baseline);
          }),
        ),
    });
  }),
);
