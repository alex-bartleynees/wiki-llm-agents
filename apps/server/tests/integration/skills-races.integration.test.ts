import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Detail, Review, SettingsView } from "@wiki-agents/contracts/skills/model";
import { Deferred, Effect, Fiber, FileSystem, Layer, PlatformError } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { SecretMaterial } from "../../src/features/secrets/material.js";
import { makeSkills } from "../../src/features/skills/skills-live.js";
import { installStateFolder } from "../../src/features/skills/installs.js";
import { Skills } from "../../src/features/skills/skills.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode } from "./infrastructure/threads.js";

type RenameFault = (from: string, to: string) => Effect.Effect<void, PlatformError.PlatformError>;
const noFault: RenameFault = () => Effect.void;
let beforeRename = noFault;
let inspections = 0;

const FaultyFileSystem = Layer.effect(
  FileSystem.FileSystem,
  Effect.map(FileSystem.FileSystem, (fs) => ({
    ...fs,
    lstat: (path: string) => Effect.suspend(() => {
      inspections += 1;
      return fs.lstat(path);
    }),
    rename: (from: string, to: string) => Effect.suspend(() => beforeRename(from, to)).pipe(Effect.andThen(fs.rename(from, to))),
  })),
).pipe(Layer.provide(NodeFileSystem.layer));

const nothingSecret = { paths: [], names: [], envNames: [] };
const NothingSecret = Layer.succeed(SecretMaterial, SecretMaterial.of({ current: Effect.succeed(nothingSecret), latest: () => nothingSecret }));

const testSkills = Layer.unwrap(Effect.map(
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(realpathSync(tmpdir()), "wiki-agents-test-skill-races-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  ),
  (path) => makeSkills({ configDir: join(path, "config"), dataDir: join(path, "data"), home: path }),
)).pipe(Layer.provide(Layer.merge(FaultyFileSystem, NothingSecret)));

const send = (method: "PUT" | "POST", url: string, body: unknown) =>
  HttpClient.execute(HttpClientRequest.make(method)(url).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
const detail = (name: string) => HttpClient.get("/api/skills/detail?skillPath=" + name).pipe(Effect.flatMap(decode(Detail)));
const source = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n`;

const withFault = <A, E, R>(fault: RenameFault, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      beforeRename = fault;
    }),
    () => effect,
    () => Effect.sync(() => {
      beforeRename = noFault;
    }),
  );

const prepare = Effect.fnUntraced(function* (name: string) {
  const initial = yield* HttpClient.get("/api/skills/settings").pipe(Effect.flatMap(decode(SettingsView)));
  const root = dirname(dirname(initial.defaults.library));
  const library = join(root, name + "-library");
  const destination = join(root, name + "-target");
  const file = join(library, name, "SKILL.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source(name, "First"));
  expect((yield* send("PUT", "/api/skills/settings", { library, destinations: [{ label: name, path: destination }], baseHash: initial.hash })).status).toBe(200);
  const body = (action: string) => ({ skillPath: name, destination, action });
  const apply = Effect.fnUntraced(function* (action: string) {
    const review = yield* send("POST", "/api/skills/review", body(action)).pipe(Effect.flatMap(decode(Review)));
    return yield* send("POST", "/api/skills/apply", { ...body(action), token: review.token });
  });
  const live = join(destination, name);
  const records = installStateFolder(join(root, "data"), destination, name);
  const revise = () => writeFileSync(file, source(name, "Second"));
  return { library, destination, live, liveFile: join(live, "SKILL.md"), records, apply, revise };
});

const installed = Effect.fnUntraced(function* (name: string) {
  const skill = yield* prepare(name);
  expect((yield* skill.apply("install")).status).toBe(200);
  skill.revise();
  const state = readFileSync(join(skill.records, "state.json"), "utf8");
  return { ...skill, state };
});

const stages = (destination: string) => readdirSync(destination).filter((entry) => entry.startsWith(".wiki-agents-stage-"));
const denied = (path: string) =>
  PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "rename", pathOrDescriptor: path });

layer(makeTestApp({ skills: testSkills }))("skill install races", (it) => {
  it.effect("restores an edit made between verification and the move", () => Effect.gen(function* () {
    const name = "move-race";
    const skill = yield* installed(name);
    const edited = source(name, "Edited as it moved");
    const response = yield* withFault(
      (from) => Effect.sync(() => {
        if (from === skill.live) writeFileSync(skill.liveFile, edited);
      }),
      skill.apply("update"),
    );
    expect(response.status).toBe(409);
    expect(readFileSync(skill.liveFile, "utf8")).toBe(edited);
    expect(readFileSync(join(skill.records, "state.json"), "utf8")).toBe(skill.state);
    expect(existsSync(join(skill.records, "pending.json"))).toBe(false);
    expect(stages(skill.destination)).toEqual([]);
    expect((yield* detail(name)).targets[0]?.status).toBe("modified");
  }));

  it.effect("keeps a foreign folder created as a first install is published", () => Effect.gen(function* () {
    const name = "publish-race";
    const skill = yield* prepare(name);
    const response = yield* withFault(
      (_, to) => Effect.sync(() => {
        if (to !== skill.live) return;
        mkdirSync(to);
        writeFileSync(join(to, "foreign.txt"), "Foreign");
      }),
      skill.apply("install"),
    );
    expect(response.status).toBe(500);
    expect(readdirSync(skill.live)).toEqual(["foreign.txt"]);
    expect(existsSync(join(skill.records, "state.json"))).toBe(false);
    expect(existsSync(join(skill.records, "pending.json"))).toBe(false);
    expect(stages(skill.destination)).toEqual([]);
    expect((yield* detail(name)).targets[0]?.status).toBe("unmanaged");
  }));

  it.effect("keeps both copies and the journal when a foreign folder blocks an update", () => Effect.gen(function* () {
    const name = "update-race";
    const skill = yield* installed(name);
    const response = yield* withFault(
      (from, to) => Effect.sync(() => {
        if (to !== skill.live || basename(from) !== "stage") return;
        mkdirSync(to);
        writeFileSync(join(to, "foreign.txt"), "Foreign");
      }),
      skill.apply("update"),
    );
    expect(response.status).toBe(409);
    expect(readdirSync(skill.live)).toEqual(["foreign.txt"]);
    const [stage] = stages(skill.destination);
    expect(readFileSync(join(skill.destination, stage!, "old", "SKILL.md"), "utf8")).toBe(source(name, "First"));
    expect(existsSync(join(skill.records, "pending.json"))).toBe(true);
    rmSync(skill.live, { recursive: true });
    expect((yield* send("POST", "/api/skills/recover", { skillPath: name, destination: skill.destination })).status).toBe(200);
    expect(readFileSync(skill.liveFile, "utf8")).toBe(source(name, "First"));
    expect((yield* detail(name)).targets[0]?.status).toBe("update available");
  }));

  it.effect("restores the old install when publication fails", () => Effect.gen(function* () {
    const name = "publish-failure";
    const skill = yield* installed(name);
    const response = yield* withFault(
      (from, to) => to === skill.live && basename(from) === "stage" ? Effect.fail(denied(to)) : Effect.void,
      skill.apply("update"),
    );
    expect(response.status).toBe(500);
    expect(readFileSync(skill.liveFile, "utf8")).toBe(source(name, "First"));
    expect(readFileSync(join(skill.records, "state.json"), "utf8")).toBe(skill.state);
    expect(existsSync(join(skill.records, "pending.json"))).toBe(false);
    expect(stages(skill.destination)).toEqual([]);
  }));

  it.effect("finishes the cleanup of a published update on recovery when its record can't be written", () => Effect.gen(function* () {
    const name = "record-failure";
    const skill = yield* installed(name);
    const record = join(skill.records, "state.json");
    const response = yield* withFault((_, to) => to === record ? Effect.fail(denied(to)) : Effect.void, skill.apply("update"));
    expect(response.status).toBe(500);
    expect(readFileSync(record, "utf8")).toBe(skill.state);
    expect(readdirSync(skill.records).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    expect((yield* detail(name)).targets[0]?.needsRecovery).toBe(true);
    expect((yield* send("POST", "/api/skills/recover", { skillPath: name, destination: skill.destination })).status).toBe(200);
    expect(readFileSync(skill.liveFile, "utf8")).toBe(source(name, "Second"));
    expect((yield* detail(name)).targets[0]?.status).toBe("installed");
  }));

  it.effect("finishes an activation whose request closes and keeps readers out until it ends", () => Effect.gen(function* () {
    const name = "closed-request";
    const skill = yield* installed(name);
    const skills = yield* Skills;
    const moved = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const plan = yield* skills.plan({ skillPath: name, destination: skill.destination, action: "update" });
    yield* withFault(
      (_, to) => to === skill.live ? Deferred.succeed(moved, undefined).pipe(Effect.andThen(Deferred.await(resume))) : Effect.void,
      Effect.gen(function* () {
        const applying = yield* Effect.forkChild(plan.apply, { startImmediately: true });
        yield* Deferred.await(moved);
        expect(existsSync(skill.live)).toBe(false);
        const before = inspections;
        const reading = yield* Effect.forkChild(skills.detail({ skillPath: name }), { startImmediately: true });
        expect(inspections).toBe(before);
        const competing = yield* Effect.forkChild(skills.recover({ skillPath: name, destination: skill.destination }), { startImmediately: true });
        expect(inspections).toBe(before);
        const closing = yield* Effect.forkChild(Fiber.interrupt(applying), { startImmediately: true });
        expect(applying.pollUnsafe()).toBeUndefined();
        expect(reading.pollUnsafe()).toBeUndefined();
        yield* Deferred.succeed(resume, undefined);
        yield* Fiber.join(closing);
        yield* Fiber.join(competing);
        expect((yield* Fiber.join(reading)).targets[0]?.status).toBe("installed");
      }).pipe(Effect.ensuring(Deferred.succeed(resume, undefined))),
    );
    expect(readFileSync(skill.liveFile, "utf8")).toBe(source(name, "Second"));
    expect(existsSync(join(skill.records, "pending.json"))).toBe(false);
    expect(stages(skill.destination)).toEqual([]);
  }));

  it.effect("applies one of two concurrent activations of the same review", () => Effect.gen(function* () {
    const name = "double-apply";
    const skill = yield* installed(name);
    const skills = yield* Skills;
    const request = { skillPath: name, destination: skill.destination, action: "update" as const };
    const plans = yield* Effect.all([skills.plan(request), skills.plan(request)]);
    const results = yield* Effect.all(plans.map((plan) => Effect.result(plan.apply)), { concurrency: "unbounded" });
    expect(results.map((result) => result._tag).sort()).toEqual(["Failure", "Success"]);
    expect((yield* detail(name)).targets[0]?.status).toBe("installed");
    expect(existsSync(join(skill.records, "pending.json"))).toBe(false);
  }));

  it.effect("leaves no claimed folder or stage when an import can't be published", () => Effect.gen(function* () {
    const name = "import-failure";
    const skill = yield* prepare("import-host");
    const incoming = join(dirname(skill.library), "import-incoming");
    mkdirSync(join(incoming, "references"), { recursive: true });
    writeFileSync(join(incoming, "SKILL.md"), source(name, "Imported"));
    const target = join(skill.library, name);
    const response = yield* withFault((_, to) => to === target ? Effect.fail(denied(to)) : Effect.void, send("POST", "/api/skills/import", { path: incoming }));
    expect(response.status).toBe(500);
    expect(readdirSync(skill.library)).toEqual(["import-host"]);
  }));
});
