import { chmodSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test("configures, browses, authors, imports and manages a local skill", async ({ page }, testInfo) => {
  const root = join(process.env["E2E_ROOT"]!, "skills-" + testInfo.project.name);
  const library = join(root, "library");
  const destination = join(root, "destination");
  const skill = "field-notes";
  const live = join(destination, skill, "SKILL.md");
  const skillMarkdown = (description: string) => `---\nname: ${skill}\ndescription: ${description}\n---\n\n# Field notes\n`;

  const nested = join(library, "external", "code-review");
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(library, "code-review"), { recursive: true });
  writeFileSync(join(nested, "SKILL.md"), "---\nname: code-review\ndescription: External review\n---\n");
  writeFileSync(join(nested, "rules.txt"), "Review rules");
  writeFileSync(join(library, "code-review", "SKILL.md"), "---\nname: code-review\ndescription: Root review\n---\n");

  await page.goto("/");
  await page.getByRole("link", { name: "Skills", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Skills( settings)?$/ })).toBeVisible();
  const phone = testInfo.project.name === "phone";
  const tabs = page.getByRole("group", { name: "Skill views" });
  const openPanel = async (name: string) => {
    if (phone) await tabs.getByRole("button", { name, exact: true }).click();
  };
  const back = async () => {
    if (phone) await page.getByRole("button", { name: "← Skills", exact: true }).click();
  };
  const libraryInput = page.getByRole("textbox", { name: "Library folder", exact: true });
  if (!(await libraryInput.isVisible())) {
    const settings = page.getByRole("button", { name: "Skills settings", exact: true });
    await expect(settings.or(libraryInput)).toBeVisible();
    if (await settings.isVisible()) await settings.click();
  }
  await page.getByRole("button", { name: "Browse…" }).click();
  const picker = page.getByRole("dialog", { name: "Choose the library folder" });
  await picker.getByLabel("Folder path").fill(root);
  await picker.getByRole("button", { name: "Go" }).click();
  await picker.getByRole("button", { name: "library", exact: true }).click();
  await picker.getByRole("button", { name: "Choose this folder" }).click();
  await expect(picker).toBeHidden();
  await expect(libraryInput).toHaveValue(library);
  const remove = page.getByRole("button", { name: "Remove destination" });
  for (let count = await remove.count(); count > 0; count--) await remove.first().click();
  await page.getByRole("button", { name: "Add destination", exact: true }).click();
  await page.getByLabel("Destination label").fill("Local provider");
  await page.getByLabel("Destination folder").fill(destination);
  await page.getByRole("button", { name: "Preview resolved paths" }).click();
  await expect(page.getByRole("region", { name: "Resolved paths" })).toContainText(destination);
  await page.getByRole("button", { name: "Save Skills settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Skills settings", exact: true }).click();
  await expect(libraryInput).toHaveValue(library);
  await page.getByRole("button", { name: "Back to skills" }).click();

  await page.getByRole("button", { name: /code-review External review/ }).click();
  await openPanel("Details");
  await expect(page.getByRole("region", { name: "Supporting files" })).toContainText("rules.txt");
  await page.getByRole("button", { name: "Edit SKILL.md" }).click();
  await page.getByRole("textbox", { name: "Skill source" }).fill("---\nname: code-review\ndescription: Edited nested review\n---\n");
  await page.getByRole("button", { name: "Save SKILL.md" }).click();
  await openPanel("Install");
  await page.getByRole("button", { name: "Review install" }).click();
  await page.getByRole("button", { name: "Confirm install" }).click();
  await expect(page.getByRole("button", { name: "Review remove" })).toBeVisible();
  expect(readFileSync(join(destination, "code-review", "rules.txt"), "utf8")).toBe("Review rules");
  await back();
  await page.getByRole("button", { name: /code-review Root review/ }).click();
  await openPanel("Install");
  await expect(page.getByRole("region", { name: "Skill detail" })).toContainText("managed for external/code-review");

  await back();
  await page.getByRole("button", { name: /New skill/ }).click();
  await page.getByLabel("New skill name").fill(skill);
  await page.getByRole("button", { name: "Create skill" }).click();
  await page.getByRole("textbox", { name: "Skill source" }).fill(skillMarkdown("Personal field notes"));
  await page.getByRole("button", { name: "Save SKILL.md" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved in the library" })).toBeVisible();
  await back();
  await page.getByLabel("Search skills").fill("personal");
  await page.getByRole("button", { name: /field-notes Personal/ }).click();

  await page.getByRole("button", { name: "Edit SKILL.md" }).click();
  await page.getByRole("textbox", { name: "Skill source" }).fill(skillMarkdown("Draft"));
  writeFileSync(join(library, skill, "SKILL.md"), skillMarkdown("External field notes"));
  await page.getByRole("button", { name: "Save SKILL.md" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "changed on disk" })).toBeVisible();
  await page.getByRole("button", { name: "Use disk version" }).click();
  await expect(page.getByLabel("SKILL.md preview")).toContainText("External field notes");

  await openPanel("Install");
  await page.getByRole("button", { name: "Review install" }).click();
  const review = page.getByRole("region", { name: "Install review" });
  await expect(review).toContainText(join(destination, skill));
  await expect(review).toContainText("added SKILL.md");
  await page.getByRole("button", { name: "Confirm install" }).click();
  await expect(page.getByRole("button", { name: "Review remove" })).toBeVisible();
  expect(readFileSync(live, "utf8")).toContain("External field notes");

  await page.getByRole("button", { name: "Edit SKILL.md" }).click();
  await page.getByRole("textbox", { name: "Skill source" }).fill(skillMarkdown("Updated field notes"));
  await page.getByRole("button", { name: "Save SKILL.md" }).click();
  await openPanel("Install");
  await page.getByRole("button", { name: "Review update" }).click();
  await expect(review).toContainText("Updated field notes");
  await page.getByRole("button", { name: "Confirm update" }).click();
  await expect(page.getByRole("region", { name: "Skill detail" })).toContainText("Up to date");
  await page.getByRole("button", { name: "Review rollback" }).click();
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  await expect(page.getByRole("button", { name: "Review update" })).toBeVisible();
  expect(readFileSync(live, "utf8")).toContain("External field notes");
  await page.getByRole("button", { name: "Review remove" }).click();
  await page.getByRole("button", { name: "Confirm remove" }).click();
  await expect(page.getByRole("button", { name: "Review install" })).toBeVisible();

  const incoming = join(root, "incoming");
  mkdirSync(incoming, { recursive: true });
  writeFileSync(join(incoming, "SKILL.md"), "---\nname: imported\ndescription: Imported instructions\n---\n");
  writeFileSync(join(incoming, "support.txt"), "Bundle data");
  mkdirSync(join(destination, "imported"), { recursive: true });
  writeFileSync(join(destination, "imported", "SKILL.md"), "Unmanaged content");
  await back();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const importInput = page.getByRole("textbox", { name: "Local folder to import", exact: true });
  await page.getByRole("button", { name: "Browse…" }).click();
  const importPicker = page.getByRole("dialog", { name: "Choose the skill folder to import" });
  await importPicker.getByLabel("Folder path").fill(root);
  await importPicker.getByRole("button", { name: "Go" }).click();
  await importPicker.getByRole("button", { name: "incoming", exact: true }).click();
  await importPicker.getByRole("button", { name: "Choose this folder" }).click();
  await expect(importPicker).toBeHidden();
  await expect(importInput).toHaveValue(incoming);
  expect((await page.request.get("/api/skills/detail?skillPath=imported")).status()).toBe(404);
  await page.getByRole("button", { name: "Import skill" }).click();
  const detail = page.getByRole("region", { name: "Skill detail" });
  await openPanel("Details");
  await expect(detail.getByRole("region", { name: "Supporting files" })).toContainText("support.txt");
  await openPanel("Install");
  await expect(detail.getByRole("region", { name: "Install destinations" })).toContainText("Unmanaged conflict");
  expect(readFileSync(join(destination, "imported", "SKILL.md"), "utf8")).toBe("Unmanaged content");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
});

test("Skills layouts inherit the theme and font roles selected in Appearance", async ({ page }, info) => {
  const library = join(process.env["E2E_ROOT"]!, "skills-appearance-" + info.project.name);
  const skillDocument = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${"Review the source before saving changes.\n\n".repeat(12)}`;
  for (const [name, description] of [
    ["delete-comment", "Audit and remove unnecessary source code comments in reviewable batches."],
    ["google-calendar-workflow", "Work with calendar events and reminders on the local host."],
    ["gws-drive-auth", "Follow the authentication rules for Drive and Calendar."],
    ["manage-child-threads", "Coordinate a builder and independent reviewers through child threads."],
    ["llm-wiki", "This bundle has invalid frontmatter for its folder."],
  ]) {
    mkdirSync(join(library, name!), { recursive: true });
    const content = skillDocument(name === "llm-wiki" ? "different-name" : name!, description!);
    writeFileSync(join(library, name!, "SKILL.md"), name === "delete-comment" ? content.replace("name: delete-comment", 'name: delete-comment\nversion: "1.0.0"') : content);
  }
  const settingsResponse = await page.request.get("/api/skills/settings");
  const { hash } = await settingsResponse.json();
  expect((await page.request.put("/api/skills/settings", { data: { library, destinations: [], baseHash: hash } })).ok()).toBe(true);

  await page.goto("/settings");
  await page.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Gruvbox Dark Hard" }).click();
  await page.getByRole("link", { name: "Skills", exact: true }).click();
  const catalog = page.getByRole("region", { name: "Skills library" });
  const skill = catalog.getByRole("button", { name: /delete-comment Audit/ });
  const settingsButton = page.getByRole("button", { name: "Skills settings", exact: true });
  await expect(skill).toBeVisible();
  await page.screenshot({ path: info.outputPath("skills-library.png") });
  await settingsButton.click();
  const libraryInput = page.getByRole("textbox", { name: "Library folder", exact: true });
  await expect(libraryInput).toHaveValue(library);
  await page.screenshot({ path: info.outputPath("skills-settings.png") });
  await page.getByRole("button", { name: "Back to skills" }).click();
  await skill.click();
  const detail = page.getByRole("region", { name: "Skill detail" });
  await expect(detail.getByLabel("SKILL.md preview")).toBeVisible();
  await expect(detail.getByText("1.0.0", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("skill-detail.png") });

  await page.goto("/settings");
  await page.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Light" }).click();
  await page.getByRole("group", { name: "Interface font" }).getByRole("combobox").selectOption("system");
  await page.getByRole("group", { name: "Reading font" }).getByRole("combobox").selectOption("system");
  const code = page.getByRole("group", { name: "Code font" });
  await code.getByRole("combobox").selectOption("custom");
  await code.getByRole("textbox", { name: "Code font name" }).fill("JetBrains Mono");
  await page.getByRole("link", { name: "Skills", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(catalog.getByRole("button", { name: /google-calendar-workflow Work/ })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(skill).toHaveCSS("font-family", /system-ui/);
  await catalog.getByRole("button", { name: "Needs attention 1" }).click();
  await expect(skill).toBeHidden();
  await expect(catalog.getByText("llm-wiki", { exact: true })).toBeVisible();
  await catalog.getByRole("button", { name: "Valid 4" }).click();
  await skill.click();
  await expect(detail.getByText("Audit and remove unnecessary source code comments in reviewable batches.", { exact: true })).toHaveCSS("font-family", /ui-serif/);
  await expect(detail.getByLabel("SKILL.md preview")).toHaveCSS("font-family", /JetBrains Mono/);
  await expect(detail.getByLabel("SKILL.md preview")).toHaveCSS("background-color", "rgb(238, 240, 243)");
  if (info.project.name === "phone") await page.getByRole("button", { name: "← Skills", exact: true }).click();
  await settingsButton.click();
  await expect(libraryInput).toHaveCSS("font-family", /JetBrains Mono/);
  await expect(page.getByRole("region", { name: "Resolved paths" })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(info.project.use.viewport!.width);
});

test("keeps 28 skills scrollable and makes mixed install states actionable", async ({ page }, info) => {
  const root = join(process.env["E2E_ROOT"]!, "skills-long-" + info.project.name);
  const library = join(root, "library");
  const first = join(root, "first");
  const second = join(root, "second");
  const skillPath = "z-group/shared-skill";
  const longDescription = "Review each part of the working tree with a separate checklist and compare the result with the expected behavior. ".repeat(6) + "End of the full description.";
  const source = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# Skill directions\n`;
  for (const path of [...Array.from({ length: 26 }, (_, n) => "bundle-" + String(n).padStart(2, "0")), "shared-skill", skillPath]) {
    mkdirSync(join(library, path), { recursive: true });
    writeFileSync(join(library, path, "SKILL.md"), source(path.split("/").at(-1)!, longDescription));
  }
  const { hash } = await (await page.request.get("/api/skills/settings")).json();
  const destinations = [{ label: "First provider", path: first }, { label: "Second provider", path: second }];
  expect((await page.request.put("/api/skills/settings", { data: { library, destinations, baseHash: hash } })).ok()).toBe(true);
  async function apply(destination: string, action: string) {
    const request = { skillPath, destination, action };
    const review = await page.request.post("/api/skills/review", { data: request });
    expect(review.ok()).toBe(true);
    const { token } = await review.json();
    expect((await page.request.post("/api/skills/apply", { data: { ...request, token } })).ok()).toBe(true);
  }
  await apply(first, "install");
  await apply(second, "install");

  await page.goto("/skills");
  const heading = page.getByRole("heading", { name: "Skills", exact: true });
  await expect(heading).toHaveCSS("text-transform", "uppercase");
  await expect(heading).toHaveCSS("font-size", "11px");
  await expect(heading).toHaveCSS("font-family", /IBM Plex Mono/);
  const catalog = page.getByRole("region", { name: "Skills library" });
  const results = catalog.getByRole("region", { name: "Skill results" });
  const search = catalog.getByRole("searchbox", { name: "Search skills" });
  const filter = catalog.getByRole("button", { name: "All 28", exact: true });
  const nested = results.getByRole("button", { name: /z-group\/shared-skill/ });
  await expect(results.getByRole("button")).toHaveCount(28);
  const firstDescription = results.getByRole("button").first().locator("span");
  await expect(firstDescription).toHaveCSS("-webkit-line-clamp", "2");
  expect(await firstDescription.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(20);
  const scroll = await results.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return { top: element.scrollTop, bottom: element.getBoundingClientRect().bottom, height: window.innerHeight };
  });
  expect(scroll.top).toBeGreaterThan(0);
  expect(scroll.bottom).toBeLessThanOrEqual(scroll.height);
  await expect(search).toBeInViewport();
  await expect(filter).toBeInViewport();
  await expect(nested).toBeInViewport();
  await expect(nested.getByText(skillPath, { exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("skills-long-library.png") });
  await nested.click();

  const detail = page.getByRole("region", { name: "Skill detail" });
  const summary = detail.getByLabel("Install status");
  const manage = detail.getByRole("button", { name: "Manage installs", exact: true });
  const installs = detail.getByRole("region", { name: "Install destinations" });
  await expect(detail.getByText(longDescription, { exact: true })).toBeVisible();
  await expect(summary).toHaveText("Up to date · 2 destinations");
  await manage.click();
  await expect(installs).toBeFocused();
  await manage.click();
  await expect(installs).toBeFocused();
  await expect(installs.getByText("Up to date", { exact: true })).toHaveCount(2);

  await apply(second, "remove");
  mkdirSync(join(second, "shared-skill"), { recursive: true });
  writeFileSync(join(second, "shared-skill", "SKILL.md"), "Unmanaged");
  writeFileSync(join(library, skillPath, "SKILL.md"), source("shared-skill", longDescription + " Updated."));
  if (info.project.name === "phone") await detail.getByRole("button", { name: "← Skills", exact: true }).click();
  await nested.click();
  await expect(summary).toHaveText("Mixed · 1 update available, 1 unmanaged conflict");
  await manage.click();
  await expect(installs).toBeFocused();
  await expect(installs.getByText("Update available", { exact: true })).toBeVisible();
  await expect(installs.getByText("Unmanaged conflict", { exact: true })).toBeVisible();
  await expect(installs.getByRole("button", { name: "Review update", exact: true })).toBeVisible();
  await expect(installs.getByRole("button", { name: "Review install", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("skills-mixed-installs.png") });
});

test("previews shared destinations and recognises external installs without offering mutations", async ({ page }, info) => {
  const root = join(process.env["E2E_ROOT"]!, "skills-alias-" + info.project.name);
  const library = join(root, "library");
  const shared = join(root, ".agents", "skills");
  const alias = join(root, ".claude", "skills");
  const nested = join(shared, "nested");
  mkdirSync(shared, { recursive: true });
  mkdirSync(join(root, ".claude"), { recursive: true });
  symlinkSync(shared, alias);
  const document = (name: string) => `---\nname: ${name}\ndescription: Review local changes.\n---\n`;
  for (const name of ["delete-comment", "different", "linked", "managed"]) {
    const folder = join(library, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "SKILL.md"), document(name));
  }
  cpSync(join(library, "delete-comment"), join(shared, "delete-comment"), { recursive: true });
  writeFileSync(join(library, "different", "guide.md"), "Original guide");
  writeFileSync(join(library, "different", "script.sh"), "echo preview", { mode: 0o644 });
  writeFileSync(join(library, "different", "library-only.md"), "Library only");
  cpSync(join(library, "different"), join(shared, "different"), { recursive: true });
  writeFileSync(join(shared, "different", "guide.md"), "Edited guide");
  chmodSync(join(shared, "different", "script.sh"), 0o755);
  rmSync(join(shared, "different", "library-only.md"));
  writeFileSync(join(shared, "different", "notes.txt"), "External supporting file");
  symlinkSync(join(library, "linked"), join(shared, "linked"));

  await page.goto("/skills");
  const settings = page.getByRole("button", { name: "Skills settings", exact: true });
  const heading = page.getByRole("heading", { name: "Skills settings", exact: true });
  await expect(settings.or(heading)).toBeVisible();
  if (await settings.isVisible()) await settings.click();
  await expect(heading).toHaveCSS("font-size", "30px");
  await expect(heading).toHaveCSS("font-family", /Source Serif 4/);
  await page.getByRole("textbox", { name: "Library folder", exact: true }).fill(library);
  const remove = page.getByRole("button", { name: "Remove destination" });
  for (let count = await remove.count(); count > 0; count--) await remove.first().click();
  const add = page.getByRole("button", { name: "Add destination", exact: true });
  const labels = page.getByRole("textbox", { name: "Destination label" });
  const folders = page.getByRole("textbox", { name: "Destination folder" });
  for (const [label, path] of [["OpenCode and Codex", shared], ["Claude Code", alias], ["Nested destination", nested]] as const) {
    await add.click();
    await labels.last().fill(label);
    await folders.last().fill(path);
  }
  const preview = page.getByRole("button", { name: "Preview resolved paths" });
  const save = page.getByRole("button", { name: "Save Skills settings" });
  const paths = page.getByRole("region", { name: "Resolved paths" });
  await preview.click();
  await expect(paths).toContainText("Entered " + alias);
  await expect(paths).toContainText("Resolved " + shared);
  await expect(paths).toContainText("share one physical install destination");
  await expect(paths).toContainText("Nested destination overlap");
  await paths.getByText("OpenCode and Codex and Claude Code share one physical install destination.").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("skills-destination-preview.png") });
  await save.click();
  await expect(page.getByRole("alert")).toContainText("overlap");
  await expect(paths).toContainText("Nested destination overlap");
  await remove.last().click();
  await preview.click();
  await expect(paths).toContainText("share one physical install destination");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  await expect(folders.nth(1)).toHaveValue(alias);
  await page.getByRole("button", { name: "Back to skills" }).click();

  const detail = page.getByRole("region", { name: "Skill detail" });
  const installs = detail.getByRole("region", { name: "Install destinations" });
  const manage = detail.getByRole("button", { name: "Manage installs", exact: true });
  const catalog = page.getByRole("region", { name: "Skills library" });
  for (const name of ["delete-comment", "different", "linked"]) {
    await catalog.getByRole("button", { name: new RegExp("^" + name + " Review") }).click();
    await expect(detail.getByLabel("Install status")).toHaveText("Installed");
    await manage.click();
    await expect(installs).toBeFocused();
    await expect(installs.getByText("Managed outside wiki-agents")).toBeVisible();
    await expect(installs.getByText("OpenCode and Codex · Claude Code")).toHaveCount(1);
    await expect(installs.getByRole("button", { name: /^Review/ })).toHaveCount(0);
    const differences = installs.getByRole("group", { name: "Differences from library" });
    if (name === "different") {
      await expect(differences.getByRole("listitem")).toHaveText([
        "guide.md · Content differs",
        "library-only.md · Only in the library",
        "notes.txt · Only in the installed copy",
        "script.sh · Permissions differ",
      ]);
      await page.screenshot({ path: info.outputPath("skills-external-install.png") });
    } else {
      await expect(differences).toHaveCount(0);
    }
    if (info.project.name === "phone") await detail.getByRole("button", { name: "← Skills", exact: true }).click();
  }

  await catalog.getByRole("button", { name: /^managed Review/ }).click();
  await detail.locator(".detail-actions").getByRole("button", { name: "Install", exact: true }).click();
  await installs.getByRole("button", { name: "Review install" }).click();
  await page.getByRole("button", { name: "Confirm install" }).click();
  await expect(detail.getByLabel("Install status")).toHaveText("Up to date");
  expect(readdirSync(shared).filter((entry) => entry.startsWith(".wiki-agents"))).toEqual([]);
  const destinationKey = createHash("sha256").update(shared).digest("hex");
  expect(readdirSync(join(process.env["E2E_ROOT"]!, "data", "skill-installs", destinationKey))).toEqual(["managed"]);
  expect(readFileSync(join(alias, "managed", "SKILL.md"), "utf8")).toBe(document("managed"));
});

test("locks CodeMirror during save and discards outdated preview responses", async ({ page }, info) => {
  const library = join(process.env["E2E_ROOT"]!, "skills-delayed-" + info.project.name);
  const skillPath = "delayed-skill";
  mkdirSync(join(library, skillPath), { recursive: true });
  const file = join(library, skillPath, "SKILL.md");
  const text = (description: string) => `---\nname: ${skillPath}\ndescription: ${description}\n---\n`;
  writeFileSync(file, text("Original draft"));
  const { hash } = await (await page.request.get("/api/skills/settings")).json();
  expect((await page.request.put("/api/skills/settings", { data: { library, destinations: [], baseHash: hash } })).ok()).toBe(true);

  await page.goto("/skills");
  await page.getByRole("button", { name: /delayed-skill Original draft/ }).click();
  await page.getByRole("button", { name: "Edit SKILL.md" }).click();
  const source = page.getByRole("textbox", { name: "Skill source" });
  const submitted = text("Submitted draft");
  await source.fill(submitted);
  let finishSave!: () => void;
  const saving = new Promise<void>((resolve) => { finishSave = resolve; });
  await page.route("**/api/skills/detail", async (route) => {
    const response = await route.fetch();
    await saving;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save SKILL.md" }).click();
  try {
    await expect(source).toHaveAttribute("contenteditable", "false");
    await source.click();
    await page.keyboard.type("Must not appear");
    await expect(source).not.toContainText("Must not appear");
  } finally {
    finishSave();
  }
  await expect(page.getByRole("status").filter({ hasText: "Saved in the library." })).toBeVisible();
  expect(readFileSync(file, "utf8")).toBe(submitted);

  if (info.project.name === "phone") await page.getByRole("button", { name: "← Skills", exact: true }).click();
  await page.getByRole("button", { name: "Skills settings", exact: true }).click();
  const paths = page.getByRole("region", { name: "Resolved paths" });
  const preview = page.getByRole("button", { name: "Preview resolved paths" });
  const libraryInput = page.getByRole("textbox", { name: "Library folder", exact: true });
  await preview.click();
  await expect(paths).toContainText(library);
  await page.getByRole("button", { name: "Add destination", exact: true }).click();
  await expect(paths).not.toContainText(library);
  await page.getByRole("button", { name: "Remove destination", exact: true }).click();

  let finishPreview!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { finishPreview = resolve; });
  const intercepted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/skills/settings/preview", async (route) => {
    const response = await route.fetch();
    started();
    await pending;
    await route.fulfill({ response });
  }, { times: 1 });
  await preview.click();
  await intercepted;
  const changed = library + "-edited";
  try {
    await libraryInput.fill(changed);
    await preview.click();
    await expect(paths).toContainText(changed);
  } finally {
    const response = page.waitForResponse((entry) =>
      entry.url().endsWith("/api/skills/settings/preview") && entry.request().postDataJSON().library === library);
    finishPreview();
    await response;
  }
  await expect(paths).toContainText(changed);

  const alert = page.getByRole("alert");
  await page.route("**/api/skills/settings/preview", (route) => route.fulfill({ status: 500, body: "Preview failed for this draft" }), { times: 1 });
  await preview.click();
  await expect(alert).toHaveText("Preview failed for this draft");
  const latest = changed + "-corrected";
  await libraryInput.fill(latest);
  await expect(alert).toHaveCount(0);

  let finishError!: () => void;
  let errorStarted!: () => void;
  const waitError = new Promise<void>((resolve) => { finishError = resolve; });
  const errorIntercepted = new Promise<void>((resolve) => { errorStarted = resolve; });
  await page.route("**/api/skills/settings/preview", async (route) => {
    errorStarted();
    await waitError;
    await route.fulfill({ status: 500, body: "Stale preview error" });
  }, { times: 1 });
  await preview.click();
  await errorIntercepted;
  try {
    await libraryInput.fill(latest + "-again");
    await preview.click();
    await expect(paths).toContainText(latest + "-again");
  } finally {
    const response = page.waitForResponse((entry) =>
      entry.url().endsWith("/api/skills/settings/preview") && entry.request().postDataJSON().library === latest);
    finishError();
    await response;
  }
  await expect(alert).toHaveCount(0);
  await expect(paths).toContainText(latest + "-again");
});
