import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { Catalog, Detail, Review, SettingsPreview, SettingsView } from "@wiki-agents/contracts/skills/model";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { readBundle } from "../../src/features/skills/bundle.js";
import { installStateFolder } from "../../src/features/skills/installs.js";
import { makeSkills } from "../../src/features/skills/filesystem.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode } from "./infrastructure/threads.js";

const root = realpathSync(tmpdir());
const testSkills = Layer.unwrap(Effect.map(
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(root, "wiki-agents-test-skills-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  ),
  (path) => makeSkills({
    configDir: join(path, "config"),
    dataDir: join(path, "data"),
    home: path,
  }),
));

const stateFolder = (configLibrary: string, destination: string, name: string) =>
  installStateFolder(join(dirname(dirname(configLibrary)), "data"), destination, name);

const app = makeTestApp({ skills: testSkills });
const settingsPath = "/api/skills/settings";
const detailPath = "/api/skills/detail";
const send = (method: "PUT" | "POST", url: string, body: unknown) =>
  HttpClient.execute(HttpClientRequest.make(method)(url).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
const readSettings = () => HttpClient.get(settingsPath).pipe(Effect.flatMap(decode(SettingsView)));
const skillUrl = (skillPath: string) => detailPath + "?skillPath=" + encodeURIComponent(skillPath);
const detail = (skillPath: string) => HttpClient.get(skillUrl(skillPath)).pipe(Effect.flatMap(decode(Detail)));
const putSkill = (skillPath: string, content: string, baseHash: string | null) => send("PUT", detailPath, { skillPath, content, baseHash });
const recover = (skillPath: string, destination: string) => send("POST", "/api/skills/recover", { skillPath, destination });
const source = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\nSkill instructions.\n`;

layer(app)("local skills", (it) => {
  it.effect("configures an empty library, checks edits and reviews, then installs, updates, rolls back and removes", () => Effect.gen(function* () {
    const initial = yield* readSettings();
    expect(initial.settings).toBeNull();
    const library = initial.defaults.library;
    const destination = initial.defaults.destinations[0]!.path;
    const settings = { library, destinations: [{ label: "Local", path: destination }], baseHash: initial.hash };
    expect((yield* send("POST", settingsPath + "/preview", settings)).status).toBe(200);
    expect(existsSync(library)).toBe(false);
    const saved = yield* send("PUT", settingsPath, settings).pipe(Effect.flatMap(decode(SettingsView)));
    expect(saved.settings?.library).toBe(library);
    expect((yield* send("PUT", settingsPath, settings)).status).toBe(409);

    const name = "local-example";
    const created = yield* putSkill(name, "", null).pipe(Effect.flatMap(decode(Detail)));
    const path = join(library, name);
    const file = join(path, "SKILL.md");
    const installFolder = join(destination, name);
    const installedFile = join(installFolder, "SKILL.md");
    const first = source(name, "First revision");
    writeFileSync(file, first);
    expect((yield* putSkill(name, source(name, "Stale editor"), created.hash)).status).toBe(409);
    expect(readFileSync(file, "utf8")).toBe(first);

    const plan = (action: string) => send("POST", "/api/skills/review", { skillPath: name, action, destination });
    const review = (action: string) => plan(action).pipe(Effect.flatMap(decode(Review)));
    const apply = (action: string, token: string) => send("POST", "/api/skills/apply", { skillPath: name, action, token, destination });
    mkdirSync(installFolder, { recursive: true });
    writeFileSync(installedFile, "Unmanaged");
    expect((yield* detail(name)).targets[0]?.status).toBe("unmanaged");
    expect((yield* plan("install")).status).toBe(409);
    expect((yield* plan("remove")).status).toBe(409);
    expect(readFileSync(installedFile, "utf8")).toBe("Unmanaged");
    rmSync(installFolder, { recursive: true });

    const stale = yield* review("install");
    writeFileSync(join(path, "helper.sh"), "#!/bin/sh\nexit 91\n", { mode: 0o755 });
    expect((yield* apply("install", stale.token)).status).toBe(409);
    expect(existsSync(installFolder)).toBe(false);
    const install = yield* review("install");
    expect(install.files.map((file) => file.path)).toContain("helper.sh");
    const applied = yield* Effect.all([apply("install", install.token), apply("install", install.token)], { concurrency: "unbounded" });
    expect(applied.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(statSync(join(installFolder, "helper.sh")).mode & 0o111).toBe(0o111);

    const records = stateFolder(initial.defaults.library, destination, name);
    expect(existsSync(join(records, "state.json"))).toBe(true);
    expect((yield* detail(name)).targets[0]?.status).toBe("installed");
    const second = source(name, "Second revision");
    const edited = yield* putSkill(name, second, (yield* detail(name)).hash).pipe(Effect.flatMap(decode(Detail)));
    expect(edited.targets[0]?.status).toBe("update available");
    expect(readFileSync(installedFile, "utf8")).toBe(first);
    const update = yield* review("update");
    expect(update).toMatchObject({ path: installFolder, before: first, after: second });
    writeFileSync(installedFile, "External edit");
    expect((yield* apply("update", update.token)).status).toBe(409);
    expect((yield* detail(name)).targets[0]?.status).toBe("modified");
    expect((yield* plan("remove")).status).toBe(409);
    writeFileSync(installedFile, first);
    expect((yield* apply("update", (yield* review("update")).token)).status).toBe(200);
    expect(readFileSync(installedFile, "utf8")).toBe(second);
    const current = JSON.parse(readFileSync(join(records, "state.json"), "utf8"));
    const workspace = randomUUID();
    const staging = join(destination, ".wiki-agents-stage-" + workspace);
    mkdirSync(staging);
    const pending = { next: { current: "0".repeat(64), previous: current.current, skillPath: name, transaction: workspace }, workspace, before: current.current };
    writeFileSync(join(records, "pending.json"), JSON.stringify(pending));
    renameSync(installFolder, join(staging, "old"));
    expect((yield* detail(name)).targets[0]).toMatchObject({ status: "conflict", needsRecovery: true });
    expect(existsSync(installedFile)).toBe(false);
    expect(existsSync(join(staging, "old", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(records, "pending.json"), "utf8")).toBe(JSON.stringify(pending));
    expect((yield* recover(name, destination)).status).toBe(200);
    expect((yield* detail(name)).targets[0]?.status).toBe("installed");
    expect(readFileSync(installedFile, "utf8")).toBe(second);
    expect(existsSync(join(records, "pending.json"))).toBe(false);
    expect(existsSync(staging)).toBe(false);
    expect((yield* apply("rollback", (yield* review("rollback")).token)).status).toBe(200);
    expect(readFileSync(installedFile, "utf8")).toBe(first);
    expect((yield* apply("remove", (yield* review("remove")).token)).status).toBe(200);
    expect(existsSync(installFolder)).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(second);
    expect((yield* apply("rollback", (yield* review("rollback")).token)).status).toBe(200);
    expect(readFileSync(installedFile, "utf8")).toBe(first);
  }));

  it.effect("browses an existing library and imports complete bundles while refusing unsafe supporting files", () => Effect.gen(function* () {
    const current = yield* readSettings();
    const folder = join(current.defaults.library, "..", "existing");
    mkdirSync(join(folder, "from-checkout"), { recursive: true });
    writeFileSync(join(folder, "from-checkout", "SKILL.md"), source("from-checkout", "Searchable description"));
    const saved = yield* send("PUT", settingsPath, { library: folder, destinations: [], baseHash: current.hash }).pipe(Effect.flatMap(decode(SettingsView)));
    expect(saved.settings?.library).toBe(folder);
    const catalog = yield* HttpClient.get("/api/skills").pipe(Effect.flatMap(decode(Catalog)));
    expect(catalog.skills.map((skill) => skill.name)).toEqual(["from-checkout"]);

    const incoming = join(folder, "..", "incoming");
    mkdirSync(join(incoming, "references"), { recursive: true });
    writeFileSync(join(incoming, "SKILL.md"), source("copied", "Complete bundle"));
    writeFileSync(join(incoming, "references", "notes.txt"), "Supporting text");
    symlinkSync(join(incoming, "references", "notes.txt"), join(incoming, "link"));
    const importSkill = () => send("POST", "/api/skills/import", { path: incoming });
    expect((yield* importSkill()).status).toBe(422);
    expect(existsSync(join(folder, "copied"))).toBe(false);
    rmSync(join(incoming, "link"));
    writeFileSync(join(incoming, ".env"), "TOKEN=fake");
    expect((yield* importSkill()).status).toBe(422);
    rmSync(join(incoming, ".env"));
    expect((yield* importSkill().pipe(Effect.flatMap(decode(Detail)))).files).toEqual(["references/notes.txt"]);
    expect(readFileSync(join(folder, "copied", "references", "notes.txt"), "utf8")).toBe("Supporting text");
    expect((yield* importSkill()).status).toBe(409);
    mkdirSync(join(folder, "claimed"));
    expect((yield* putSkill("claimed", "", null)).status).toBe(409);
    expect(readdirSync(join(folder, "claimed"))).toEqual([]);
    expect(readdirSync(folder).filter((entry) => entry.startsWith(".skill-"))).toEqual([]);
  }));

  it.effect("uses nested paths for edits, reviews and ownership while keeping provider installs flat", () => Effect.gen(function* () {
    const current = yield* readSettings();
    const library = join(current.defaults.library, "..", "agent-skills");
    const destination = join(library, "..", "target");
    const direct = "code-review";
    const nested = "external/code-review";
    const content = source(direct, "Review a change");
    for (const skillPath of ["delete-comment", direct, nested]) {
      mkdirSync(join(library, skillPath, "references"), { recursive: true });
      const name = skillPath.split("/").at(-1)!;
      writeFileSync(join(library, skillPath, "SKILL.md"), source(name, "Review a change"));
      writeFileSync(join(library, skillPath, "references", "rules.txt"), "Supporting rules");
    }
    mkdirSync(join(library, "..", "outside", "escape"), { recursive: true });
    writeFileSync(join(library, "..", "outside", "escape", "SKILL.md"), source("escape", "Outside library"));
    symlinkSync(join(library, "..", "outside"), join(library, "linked"));
    const settings = { library, destinations: [{ label: "Provider", path: destination }], baseHash: current.hash };
    expect((yield* send("PUT", settingsPath, settings)).status).toBe(200);
    const catalog = yield* HttpClient.get("/api/skills").pipe(Effect.flatMap(decode(Catalog)));
    expect(catalog.skills.map((skill) => skill.skillPath)).toEqual([direct, "delete-comment", nested]);
    expect((yield* HttpClient.get(skillUrl("linked/escape"))).status).toBe(404);
    expect((yield* HttpClient.get(skillUrl("../outside/escape"))).status).toBe(422);
    expect((yield* putSkill("linked/escape", content, null)).status).toBe(404);

    const input = (skillPath: string, action: string) => ({ skillPath, action, destination });
    const review = (skillPath: string, action: string) => send("POST", "/api/skills/review", input(skillPath, action));
    const apply = (skillPath: string, action: string, token: string) => send("POST", "/api/skills/apply", { ...input(skillPath, action), token });
    const initialReview = yield* review(nested, "install").pipe(Effect.flatMap(decode(Review)));
    expect((yield* apply(direct, "install", initialReview.token)).status).toBe(409);
    const detailBefore = yield* detail(nested);
    expect(detailBefore).toMatchObject({ skillPath: nested, name: direct, files: ["references/rules.txt"] });
    const changed = source(direct, "Review from the external group");
    expect((yield* putSkill(nested, changed, detailBefore.hash)).status).toBe(200);
    expect(readFileSync(join(library, direct, "SKILL.md"), "utf8")).toBe(content);

    const next = yield* review(nested, "install").pipe(Effect.flatMap(decode(Review)));
    expect(next.path).toBe(join(destination, direct));
    expect((yield* apply(nested, "install", next.token)).status).toBe(200);
    expect(readFileSync(join(destination, direct, "references", "rules.txt"), "utf8")).toBe("Supporting rules");
    expect((yield* detail(direct)).targets[0]).toMatchObject({ status: "conflict", actions: [] });
    for (const action of ["install", "update", "remove", "rollback"]) {
      expect((yield* review(direct, action)).status).toBe(409);
    }
    expect(readFileSync(join(destination, direct, "SKILL.md"), "utf8")).toBe(changed);
    const remove = yield* review(nested, "remove").pipe(Effect.flatMap(decode(Review)));
    expect((yield* apply(nested, "remove", remove.token)).status).toBe(200);
    const rollback = yield* review(nested, "rollback").pipe(Effect.flatMap(decode(Review)));
    expect((yield* apply(nested, "rollback", rollback.token)).status).toBe(200);
    expect((yield* detail(nested)).targets[0]?.status).toBe("installed");
  }));

  it.effect("recognizes external installs without taking ownership or conflating duplicate sources", () => Effect.gen(function* () {
    const current = yield* readSettings();
    const library = join(current.defaults.library, "..", "external-library");
    const root = join(library, "..", "external-destinations");
    const destinations = ["matching", "linked", "different", "unrelated", "wrong-link", "protected"].map((label) => ({ label, path: join(root, label) }));
    const name = "delete-comment";
    const skill = join(library, name);
    const text = source(name, "Local review");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), text, { mode: 0o644 });
    writeFileSync(join(skill, "support.txt"), "Supporting content");
    for (const destination of destinations) mkdirSync(destination.path, { recursive: true });
    const [matching, linked, different, unrelated, wrongLink, protectedPath] = destinations.map(({ path }) => join(path, name));
    cpSync(skill, matching!, { recursive: true });
    symlinkSync(skill, linked!);
    cpSync(skill, different!, { recursive: true });
    writeFileSync(join(different!, "support.txt"), "Changed support");
    cpSync(skill, unrelated!, { recursive: true });
    writeFileSync(join(unrelated!, "SKILL.md"), source("other-skill", "Unrelated"));
    symlinkSync(different!, wrongLink!);
    cpSync(skill, protectedPath!, { recursive: true });
    writeFileSync(join(protectedPath!, ".env"), "FAKE=value");

    expect((yield* send("PUT", settingsPath, { library, destinations, baseHash: current.hash })).status).toBe(200);
    const first = yield* detail(name);
    expect(first.targets.map(({ status }) => status)).toEqual([
      "external installed", "external installed", "external differs", "unmanaged", "unmanaged", "unmanaged",
    ]);
    expect(first.targets.every(({ actions }) => actions.length === 0)).toBe(true);
    for (const { path: destination } of destinations) {
      for (const action of ["install", "update", "remove", "rollback"]) {
        const body = { skillPath: name, destination, action };
        expect((yield* send("POST", "/api/skills/review", body)).status).toBe(409);
        expect((yield* send("POST", "/api/skills/apply", { ...body, token: "unowned" })).status).toBe(409);
      }
        expect(existsSync(stateFolder(current.defaults.library, destination, name))).toBe(false);
    }
    const nested = "external/" + name;
    mkdirSync(join(library, "external"));
    cpSync(skill, join(library, nested), { recursive: true });
    expect((yield* detail(name)).targets.map(({ status }) => status).slice(0, 3)).toEqual(["unmanaged", "external installed", "unmanaged"]);
    expect((yield* detail(nested)).targets.map(({ status }) => status).slice(0, 3)).toEqual(["unmanaged", "unmanaged", "unmanaged"]);
    const nestedDetail = yield* detail(nested);
    expect((yield* putSkill(nested, source(name, "A distinct nested skill"), nestedDetail.hash)).status).toBe(200);
    expect((yield* detail(name)).targets[0]?.status).toBe("external installed");
    expect((yield* detail(nested)).targets[0]?.status).toBe("unmanaged");
    expect(readFileSync(join(matching!, "SKILL.md"), "utf8")).toBe(text);
    expect(readFileSync(join(different!, "support.txt"), "utf8")).toBe("Changed support");
    expect(statSync(linked!).ino).toBe(statSync(skill).ino);
  }));

  it.effect("previews aliases and overlaps and records one physical install for two provider roots", () => Effect.gen(function* () {
    const current = yield* readSettings();
    const host = join(current.defaults.library, "..", "..");
    const library = join(host, "alias-library");
    const primary = join(host, ".agents", "skills");
    const alias = join(host, ".claude", "skills");
    mkdirSync(primary, { recursive: true });
    mkdirSync(join(host, ".claude"), { recursive: true });
    symlinkSync(primary, alias);
    const destinations = [
      { label: "OpenCode and Codex", path: "~/.agents/skills" },
      { label: "Claude Code", path: "~/.claude/skills" },
    ];
    const settings = { library: "~/alias-library", destinations, baseHash: current.hash };
    const preview = (body: unknown) => send("POST", settingsPath + "/preview", body).pipe(Effect.flatMap(decode(SettingsPreview)));
    const valid = yield* preview(settings);
    expect(valid.destinations).toEqual(destinations.map(({ label, path }) => ({ label, enteredPath: path, resolvedPath: primary })));
    expect(valid.diagnostics.map(({ kind }) => kind)).toEqual(["alias"]);
    const bad = { ...settings, destinations: [...destinations, { label: "Nested", path: join(primary, "nested") }, { label: "Library alias", path: library }] };
    const invalid = yield* preview(bad);
    expect(invalid.library).toEqual({ enteredPath: settings.library, resolvedPath: library });
    expect(invalid.destinations[2]?.resolvedPath).toBe(join(primary, "nested"));
    expect(invalid.diagnostics.map(({ kind }) => kind)).toEqual(["overlap", "alias", "overlap", "overlap"]);
    expect((yield* send("PUT", settingsPath, bad)).status).toBe(422);
    expect((yield* readSettings()).hash).toBe(current.hash);

    const saved = yield* send("PUT", settingsPath, settings).pipe(Effect.flatMap(decode(SettingsView)));
    expect(saved.settings?.destinations).toEqual(destinations.map((entry) => ({ ...entry, resolvedPath: primary })));
    expect(saved.settings).toMatchObject({ library: settings.library, libraryResolvedPath: library });
    const skillPath = "alias-review";
    expect((yield* putSkill(skillPath, "", null)).status).toBe(200);
    const created = yield* detail(skillPath);
    expect(created.targets).toHaveLength(1);
    expect(created.targets[0]?.destination).toEqual({ path: primary, labels: ["OpenCode and Codex", "Claude Code"] });
    const ownershipRoot = dirname(stateFolder(current.defaults.library, primary, skillPath));
    const existingRecords = existsSync(ownershipRoot) ? readdirSync(ownershipRoot) : [];
    const body = { skillPath, destination: primary, action: "install" };
    const plan = yield* send("POST", "/api/skills/review", body).pipe(Effect.flatMap(decode(Review)));
    expect((yield* send("POST", "/api/skills/apply", { ...body, token: plan.token })).status).toBe(200);
    expect(readdirSync(ownershipRoot).sort()).toEqual([...existingRecords, skillPath].sort());
    expect(readdirSync(primary).filter((entry) => entry.startsWith(".wiki-agents"))).toEqual([]);
    expect(readFileSync(join(alias, skillPath, "SKILL.md"), "utf8")).toBe(created.content);
    expect((yield* detail(skillPath)).targets.map(({ status }) => status)).toEqual(["installed"]);

    const redirected = join(host, "redirected");
    mkdirSync(redirected);
    rmSync(alias);
    symlinkSync(redirected, alias);
    expect((yield* HttpClient.get(skillUrl(skillPath))).status).toBe(409);
    expect(readdirSync(redirected)).toEqual([]);
  }));

  it.effect("never adopts an identical external copy placed during a pending first install", () => Effect.gen(function* () {
    const initial = yield* readSettings();
    const library = join(initial.defaults.library, "..", "race-library");
    const destination = join(library, "..", "identity-target");
    const name = "identity-skill";
    const directory = join(library, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "SKILL.md"), source(name, "Same bytes"));
    expect((yield* send("PUT", settingsPath, { library, destinations: [{ label: "Identity", path: destination }], baseHash: initial.hash })).status).toBe(200);
    const local = stateFolder(initial.defaults.library, destination, name);
    mkdirSync(local, { recursive: true });
    const workspace = randomUUID();
    const staging = join(destination, ".wiki-agents-stage-" + workspace);
    mkdirSync(staging, { recursive: true });
    const stage = join(staging, "stage");
    cpSync(directory, stage, { recursive: true });
    const digest = readBundle(directory, () => undefined).digest;
    const pending = { next: { current: digest, previous: null, skillPath: name, transaction: workspace },
      workspace, before: null };
    const journal = join(local, "pending.json");
    writeFileSync(journal, JSON.stringify(pending));
    const live = join(destination, name);
    cpSync(directory, live, { recursive: true });
    const liveIdentity = statSync(live, { bigint: true }).ino;
    expect((yield* detail(name)).targets[0]?.needsRecovery).toBe(true);
    expect(readFileSync(journal, "utf8")).toBe(JSON.stringify(pending));
    expect((yield* recover(name, destination)).status).toBe(200);
    expect(existsSync(join(local, "state.json"))).toBe(false);
    expect(statSync(live, { bigint: true }).ino).toBe(liveIdentity);
    expect((yield* detail(name)).targets[0]).toMatchObject({ status: "external installed", actions: [] });
  }));

  const managed = (name: string, label: string) => Effect.gen(function* () {
    const initial = yield* readSettings();
    const library = join(initial.defaults.library, "..", label + "-library");
    const destination = join(library, "..", label + "-target");
    expect((yield* send("PUT", settingsPath, { library, destinations: [{ label, path: destination }], baseHash: initial.hash })).status).toBe(200);
    expect((yield* putSkill(name, "", null)).status).toBe(200);
    const body = { skillPath: name, destination, action: "install" };
    const plan = yield* send("POST", "/api/skills/review", body).pipe(Effect.flatMap(decode(Review)));
    expect((yield* send("POST", "/api/skills/apply", { ...body, token: plan.token })).status).toBe(200);
    const live = join(destination, name);
    const local = stateFolder(initial.defaults.library, destination, name);
    const workspace = randomUUID();
    const stage = join(destination, ".wiki-agents-stage-" + workspace);
    const digest = readBundle(live, () => undefined).digest;
    const interrupt = (current: string | null) => {
      const next = { current, previous: digest, skillPath: name, transaction: workspace };
      const encoded = JSON.stringify({ next, workspace, before: digest });
      writeFileSync(join(local, "pending.json"), encoded);
      mkdirSync(stage);
      return { next, encoded };
    };
    const state = () => JSON.parse(readFileSync(join(local, "state.json"), "utf8"));
    return { library, destination, live, local, stage, digest, interrupt, state };
  });

  it.effect("restores the old install when publication was interrupted, including an edit made as it moved", () => Effect.gen(function* () {
    const name = "race-skill";
    const install = yield* managed(name, "move");
    const before = install.state();
    install.interrupt("0".repeat(64));
    cpSync(join(install.library, name), join(install.stage, "stage"), { recursive: true });
    renameSync(install.live, join(install.stage, "old"));
    writeFileSync(join(install.stage, "old", "SKILL.md"), source(name, "External edit during rename"));
    expect((yield* detail(name)).targets[0]?.needsRecovery).toBe(true);
    expect((yield* recover(name, install.destination)).status).toBe(200);
    expect(readFileSync(join(install.live, "SKILL.md"), "utf8")).toContain("External edit during rename");
    expect(install.state()).toEqual(before);
    expect(existsSync(install.stage)).toBe(false);
    expect((yield* detail(name)).targets[0]?.status).toBe("modified");
  }));

  it.effect("finishes a published update and an interrupted removal", () => Effect.gen(function* () {
    const name = "publish-skill";
    const install = yield* managed(name, "publish");
    const updated = install.interrupt(readBundle(join(install.library, name), () => undefined).digest);
    cpSync(install.live, join(install.stage, "old"), { recursive: true });
    expect((yield* recover(name, install.destination)).status).toBe(200);
    expect(install.state()).toEqual(updated.next);
    expect((yield* detail(name)).targets[0]?.status).toBe("installed");

    rmSync(join(install.local, "state.json"));
    writeFileSync(join(install.local, "state.json"), JSON.stringify({ ...updated.next, transaction: randomUUID() }));
    const removed = install.interrupt(null);
    renameSync(install.live, join(install.stage, "old"));
    expect((yield* recover(name, install.destination)).status).toBe(200);
    expect(install.state()).toEqual(removed.next);
    expect((yield* detail(name)).targets[0]?.status).toBe("absent");
    expect(existsSync(install.stage)).toBe(false);
  }));

  it.effect("restores an edited install instead of completing its interrupted removal", () => Effect.gen(function* () {
    const name = "edited-removal";
    const install = yield* managed(name, "edited-removal");
    install.interrupt(null);
    renameSync(install.live, join(install.stage, "old"));
    writeFileSync(join(install.stage, "old", "SKILL.md"), source(name, "Edited"));
    expect((yield* recover(name, install.destination)).status).toBe(200);
    expect(readFileSync(join(install.live, "SKILL.md"), "utf8")).toContain("Edited");
    expect((yield* detail(name)).targets[0]?.status).toBe("modified");
  }));

  it.effect("keeps both copies when a foreign folder blocks restoration", () => Effect.gen(function* () {
    const name = "restore-race";
    const install = yield* managed(name, "restore");
    const { encoded } = install.interrupt("0".repeat(64));
    cpSync(join(install.library, name), join(install.stage, "stage"), { recursive: true });
    renameSync(install.live, join(install.stage, "old"));
    mkdirSync(install.live);
    writeFileSync(join(install.live, "foreign.txt"), "Foreign");
    expect((yield* recover(name, install.destination)).status).toBe(409);
    expect(readFileSync(join(install.live, "foreign.txt"), "utf8")).toBe("Foreign");
    expect(existsSync(join(install.stage, "old", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(install.local, "pending.json"), "utf8")).toBe(encoded);
  }));

  it.effect("retries partial cleanup of a committed update without touching a later edit", () => Effect.gen(function* () {
    const name = "cleanup-skill";
    const install = yield* managed(name, "cleanup");
    const { next } = install.interrupt(install.digest);
    writeFileSync(join(install.local, "state.json"), JSON.stringify(next));
    mkdirSync(join(install.stage, "old"));
    writeFileSync(join(install.stage, "old", "remaining"), "Partially deleted");
    writeFileSync(join(install.live, "SKILL.md"), source(name, "Edited after commit"));
    expect((yield* recover(name, install.destination)).status).toBe(200);
    expect(existsSync(install.stage)).toBe(false);
    expect(install.state()).toEqual(next);
    expect((yield* detail(name)).targets[0]?.status).toBe("modified");
  }));

  it.effect("scopes recovery to the library-relative owner", () => Effect.gen(function* () {
    const name = "same-leaf";
    const nested = "group/" + name;
    const install = yield* managed(name, "owner");
    mkdirSync(join(install.library, "group"));
    cpSync(join(install.library, name), join(install.library, nested), { recursive: true });
    const { encoded } = install.interrupt(null);
    expect((yield* detail(name)).targets[0]?.needsRecovery).toBe(true);
    expect((yield* detail(nested)).targets[0]).toMatchObject({ status: "conflict", actions: [] });
    expect((yield* detail(nested)).targets[0]?.needsRecovery).toBeUndefined();
    expect((yield* recover(nested, install.destination)).status).toBe(409);
    expect(readFileSync(join(install.local, "pending.json"), "utf8")).toBe(encoded);
    expect((yield* recover(name, install.destination)).status).toBe(200);
    expect((yield* detail(name)).targets[0]?.status).toBe("installed");
  }));

  it.effect("cleans verified 0555 supporting directories while preserving live and rollback modes", () => Effect.gen(function* () {
    const initial = yield* readSettings();
    const library = join(initial.defaults.library, "..", "readonly-library");
    const destination = join(library, "..", "readonly-target");
    const name = "readonly-skill";
    const folder = join(library, name);
    const supporting = "references";
    mkdirSync(join(folder, supporting), { recursive: true });
    writeFileSync(join(folder, "SKILL.md"), source(name, "Before"));
    writeFileSync(join(folder, supporting, "kept.txt"), "Retired later");
    chmodSync(join(folder, supporting), 0o555);
    const local = stateFolder(initial.defaults.library, destination, name);
    const live = join(destination, name);
    const workspace = randomUUID();
    const stage = join(destination, ".wiki-agents-stage-" + workspace);
    const old = join(stage, "old");
    try {
      expect((yield* send("PUT", settingsPath, { library, destinations: [{ label: "Read-only", path: destination }], baseHash: initial.hash })).status).toBe(200);
      const apply = (action: string) => Effect.gen(function* () {
        const body = { skillPath: name, destination, action };
        const plan = yield* send("POST", "/api/skills/review", body).pipe(Effect.flatMap(decode(Review)));
        return yield* send("POST", "/api/skills/apply", { ...body, token: plan.token });
      });
      expect((yield* apply("install")).status).toBe(200);
      const original = readBundle(live, () => undefined).digest;
      writeFileSync(join(folder, "SKILL.md"), source(name, "After"));
      expect((yield* apply("update")).status).toBe(200);
      expect(readdirSync(destination)).toEqual([name]);
      const snapshot = join(local, original);
      expect(statSync(join(live, supporting)).mode & 0o777).toBe(0o555);
      expect(statSync(join(snapshot, supporting)).mode & 0o777).toBe(0o555);
      cpSync(snapshot, old, { recursive: true });
      chmodSync(join(old, supporting), 0o555);
      const next = { ...JSON.parse(readFileSync(join(local, "state.json"), "utf8")), transaction: workspace };
      writeFileSync(join(local, "state.json"), JSON.stringify(next));
      writeFileSync(join(local, "pending.json"), JSON.stringify({ next, before: original, workspace }));
      rmSync(join(old, "SKILL.md"));
      expect(statSync(join(old, supporting)).mode & 0o777).toBe(0o555);
      expect((yield* recover(name, destination)).status).toBe(200);
      expect(existsSync(stage)).toBe(false);
      expect(statSync(join(live, supporting)).mode & 0o777).toBe(0o555);
      expect(statSync(join(snapshot, supporting)).mode & 0o777).toBe(0o555);
      expect(readFileSync(join(snapshot, supporting, "kept.txt"), "utf8")).toBe("Retired later");
    } finally {
      for (const base of [folder, live, old, ...(existsSync(local) ? readdirSync(local).map((entry) => join(local, entry)) : [])]) {
        const path = join(base, supporting);
        if (existsSync(path)) chmodSync(path, 0o755);
      }
    }
  }));

  it.effect("reports a committed update as successful when its obsolete rollback snapshot is damaged", () => Effect.gen(function* () {
    const initial = yield* readSettings();
    const library = join(initial.defaults.library, "..", "obsolete-library");
    const destination = join(library, "..", "obsolete-target");
    const name = "obsolete-skill";
    expect((yield* send("PUT", settingsPath, { library, destinations: [{ label: "Local", path: destination }], baseHash: initial.hash })).status).toBe(200);
    let draft = yield* putSkill(name, source(name, "First revision"), null).pipe(Effect.flatMap(decode(Detail)));
    const apply = (action: string) => Effect.gen(function* () {
      const body = { skillPath: name, destination, action };
      const plan = yield* send("POST", "/api/skills/review", body).pipe(Effect.flatMap(decode(Review)));
      return yield* send("POST", "/api/skills/apply", { ...body, token: plan.token }).pipe(Effect.flatMap(decode(Detail)));
    });
    yield* apply("install");
    const live = join(destination, name);
    const first = readBundle(live, () => undefined).digest;
    const secondContent = source(name, "Second revision");
    draft = yield* putSkill(name, secondContent, draft.hash).pipe(Effect.flatMap(decode(Detail)));
    yield* apply("update");
    const second = readBundle(live, () => undefined).digest;
    const records = stateFolder(initial.defaults.library, destination, name);
    const damaged = join(records, first, "SKILL.md");
    writeFileSync(damaged, "Damaged obsolete snapshot");
    const thirdContent = source(name, "Third revision");
    yield* putSkill(name, thirdContent, draft.hash);
    const updated = yield* apply("update");

    expect(updated.targets[0]?.status).toBe("installed");
    expect(readFileSync(join(live, "SKILL.md"), "utf8")).toBe(thirdContent);
    const current = readBundle(live, () => undefined).digest;
    expect(readBundle(join(records, second), () => undefined).digest).toBe(second);
    expect(readFileSync(join(records, second, "SKILL.md"), "utf8")).toBe(secondContent);
    expect(readFileSync(damaged, "utf8")).toBe("Damaged obsolete snapshot");
    expect(JSON.parse(readFileSync(join(records, "state.json"), "utf8"))).toMatchObject({ current, previous: second });
    expect(existsSync(join(records, "pending.json"))).toBe(false);
  }));
});
