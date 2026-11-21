import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { e2eRoot, isPhone, openVault, tab } from "./app.ts";

const config = () => join(e2eRoot(), "config");

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

/** The agents list: a tab on a phone, the right pane's Agents view on desktop. */
const agentsPane = async (page: Page, info: TestInfo) => {
  await openVault(page);
  if (isPhone(info)) await tab(page, info, "Agents");
  else await page.getByRole("tablist", { name: "Right pane" }).getByRole("tab", { name: "Agents" }).click();
  return page.getByRole(isPhone(info) ? "region" : "complementary", { name: isPhone(info) ? "Agents" : "Agent threads" });
};

test("creates an agent in the app, then edits it over a change made on disk", async ({ page }, info) => {
  const width = info.project.name;
  const pane = await agentsPane(page, info);
  await pane.getByRole("link", { name: "New agent" }).click();
  await expect(page).toHaveURL(/\/agents\/edit\?from=/);

  const form = page.getByRole("form", { name: "New agent" });
  await form.getByLabel("Name", { exact: true }).fill(`Scout ${width}`);
  await expect(form.getByLabel("File name", { exact: true })).toHaveValue(`scout-${width}`);
  await form.getByLabel("Description", { exact: true }).fill("Looks around the projects.");
  await form.getByRole("radiogroup", { name: "Edit existing files" }).getByLabel("Never").check();
  await form.getByRole("radiogroup", { name: "Use other MCP servers' tools" }).getByLabel("Allowed").check();
  await form.getByRole("radiogroup", { name: "Start subagents" }).getByLabel("Allowed").check();
  const childThreads = form.getByRole("radiogroup", { name: "Start child threads" });
  await expect(childThreads.getByLabel("Never")).toBeChecked();
  await childThreads.getByLabel("Asks first").check();
  await form.getByLabel("Restrict child thread workers").check();
  await form.getByLabel("Researcher", { exact: true }).check();
  await form.getByLabel("Only these:").check();
  // Only these starts from the thread's vault and the web; leave the web out.
  await form.getByLabel("The web (as its autonomy allows)").uncheck();
  await form.getByLabel("vault", { exact: true }).check();
  await form.getByLabel("Folders in vault").fill("Projects");
  await form.getByLabel("MCP servers", { exact: true }).fill("coffee-journal, github");
  await form.getByLabel("Instructions").fill("# Scout\n\nLook around before answering.");
  await noOverflow(page);
  await form.getByRole("button", { name: "Create agent" }).click();

  await expect(page).toHaveURL(new RegExp(`/agents/edit\\?agent=scout-${width}&from=`));
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  const file = join(config(), "agents", `scout-${width}.md`);
  const written = readFileSync(file, "utf8");
  expect(written).toContain(`name: Scout ${width}\n`);
  expect(written).toContain("  edit: deny\n");
  expect(written).toContain("  tools: allow\n");
  expect(written).toContain("  subagents: allow\n");
  expect(written).toContain("  threads: ask\n");
  expect(written).toContain("workers:\n  - researcher\n");
  await expect(page.getByLabel("Researcher", { exact: true })).toBeChecked();
  expect(written).toContain("mcp: [ coffee-journal, github ]\n");
  expect(written).toContain("sources:\n  - vault\n  - vault: vault\n    folders:\n      - Projects\n");
  expect(written).toMatch(/---\n\n# Scout\n\nLook around before answering\.\n$/);

  // Someone changes the file on another machine (Syncthing) while it is open here.
  const editForm = page.getByRole("form", { name: "Edit agent" });
  await editForm.getByLabel("Description", { exact: true }).fill("Looks around carefully.");
  writeFileSync(file, written.replace("Look around before answering.", "Look around, then answer."));
  await editForm.getByRole("button", { name: "Save" }).click();

  const conflict = page.getByRole("region", { name: "Changed on disk" });
  await expect(conflict).toContainText("The file changed on disk since you opened it");
  await expect(conflict).toContainText("On disk: Looks around the projects.");
  await expect(conflict).toContainText("Yours: Looks around carefully.");
  await expect(conflict.getByLabel("Instructions: on disk, then yours")).toContainText("Look around, then answer.");
  await noOverflow(page);
  await conflict.getByRole("button", { name: "Save mine over it" }).click();
  await expect(conflict).toBeHidden();
  expect(readFileSync(file, "utf8")).toContain("description: Looks around carefully.\n");

  // Back in the list, the agent is there with its sources and autonomy.
  await page.getByRole("button", { name: "Back" }).click();
  const list = await agentsPane(page, info);
  await list.getByRole("button", { name: new RegExp(`Scout ${width}`) }).click();
  await expect(list).toContainText("vault: Projects");
  await expect(list).toContainText("The thread's vault");
  await list.getByRole("link", { name: "Edit" }).click();

  await expect(page.getByLabel("MCP servers", { exact: true })).toHaveValue("coffee-journal, github");

  // Deleting moves the file to the config folder's trash.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).not.toHaveURL(/\/agents\/edit/);
  expect(existsSync(file)).toBe(false);
  expect(existsSync(join(config(), ".trash", "agents", `scout-${width}.md`))).toBe(true);
});

test("refuses an agent the app couldn't load, saying which field is wrong", async ({ page }, info) => {
  await page.goto("/agents/edit");
  const form = page.getByRole("form", { name: "New agent" });
  await form.getByLabel("Name", { exact: true }).fill(`Empty ${info.project.name}`);
  await form.getByRole("button", { name: "Create agent" }).click();
  await expect(form).toContainText("Write what the agent should do.");
  expect(existsSync(join(config(), "agents", `empty-${info.project.name}.md`))).toBe(false);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/agents$/);
});

test("creates and edits a rules file, taking the disk's version in a conflict", async ({ page }, info) => {
  const width = info.project.name;
  const pane = await agentsPane(page, info);
  await pane.getByRole("link", { name: "New rules file" }).click();

  const form = page.getByRole("form", { name: "New rules" });
  await form.getByLabel("File name", { exact: true }).fill(`style-${width}`);
  await form.getByLabel("Rules for every agent").fill("# Style\n\n- Plain words.");
  await noOverflow(page);
  await form.getByRole("button", { name: "Create rules" }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/rules\\?rules=style-${width}&from=`));
  const file = join(config(), "rules", `style-${width}.md`);
  expect(readFileSync(file, "utf8")).toBe("# Style\n\n- Plain words.");

  const edit = page.getByRole("form", { name: "Edit rules" });
  await edit.getByLabel("Rules for every agent").fill("# Style\n\n- Plain words.\n- Short sentences.");
  writeFileSync(file, "# Style\n\n- Plain words.\n- British spelling.");
  await edit.getByRole("button", { name: "Save" }).click();
  const conflict = page.getByRole("region", { name: "Changed on disk" });
  await expect(conflict.getByLabel("On disk, then yours")).toContainText("British spelling.");
  await conflict.getByRole("button", { name: "Use the disk version" }).click();
  await expect(edit.getByLabel("Rules for every agent")).toHaveValue("# Style\n\n- Plain words.\n- British spelling.");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await edit.getByRole("button", { name: "Delete" }).click();
  await expect(page).not.toHaveURL(/\/agents\/rules/);
  expect(existsSync(file)).toBe(false);
  const list = await agentsPane(page, info);
  await expect(list.getByRole("link", { name: "rules/wiki-llm.md" })).toBeVisible();
  await expect(list.getByRole("link", { name: `rules/style-${width}.md` })).toHaveCount(0);
});

test("uses the header catalog and wiki tab to draft, review and save instructions", async ({ page }, info) => {
  await openVault(page);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Agents" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  const catalog = page.getByRole("main");
  await catalog.getByRole("button", { name: /Researcher/ }).click();
  await expect(catalog.getByRole("heading", { name: "Instructions" })).toBeVisible();
  await noOverflow(page);
  await catalog.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page).toHaveURL(/\/agents$/);

  const name = `Draft Scout ${info.project.name}`;
  const file = join(config(), "agents", `draft-scout-${info.project.name}.md`);
  await catalog.getByRole("link", { name: "New agent" }).click();
  const create = page.getByRole("form", { name: "New agent" });
  await create.getByLabel("Name", { exact: true }).fill(name);
  await create.getByLabel("Description", { exact: true }).fill("Reviews timelines.");
  await create.getByRole("combobox", { name: "Provider", exact: true }).selectOption("replay");
  await create.getByRole("button", { name: "Draft instructions", exact: true }).click();
  const draft = page.getByRole("region", { name: "Draft instructions" });
  await expect(draft.getByLabel("Draft provider")).toHaveValue("replay");
  await draft.getByLabel("Idea").fill("Review incident timelines.");
  await noOverflow(page);

  await page.route("**/api/agents/draft-instructions", (route) => route.fulfill({ status: 502, body: "Draft temporarily unavailable." }), { times: 1 });
  await draft.getByRole("button", { name: "Generate draft" }).click();
  await expect(draft.getByRole("alert")).toContainText("Draft temporarily unavailable.");
  await expect(draft.getByLabel("Idea")).toHaveValue("Review incident timelines.");
  await draft.getByRole("button", { name: "Retry" }).click();
  const preview = draft.getByLabel("Draft preview");
  await expect(preview).toContainText("# Role");
  await expect(create.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue("");
  expect(existsSync(file)).toBe(false);
  await draft.getByRole("button", { name: "Regenerate" }).click();
  await expect(draft.getByRole("button", { name: "Use draft" })).toBeEnabled();
  const original = await preview.textContent();
  await draft.getByRole("button", { name: "Use draft" }).click();
  await expect(create.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(original!);
  expect(existsSync(file)).toBe(false);
  await create.getByRole("button", { name: "Create agent" }).click();
  const edit = page.getByRole("form", { name: "Edit agent" });
  await expect(edit.getByRole("status")).toHaveText("Saved");
  expect(readFileSync(file, "utf8")).toContain(original!);
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/agents$/);

  const wiki = await agentsPane(page, info);
  await wiki.getByRole("button", { name: new RegExp(name) }).click();
  await wiki.getByRole("link", { name: "Edit", exact: true }).click();
  const instructions = edit.getByRole("textbox", { name: "Instructions", exact: true });
  await expect(instructions).toHaveValue(original!);
  let respond!: () => void;
  const delayed = new Promise<void>((resolve) => { respond = resolve; });
  await page.route("**/api/agents/draft-instructions", async (route) => {
    await delayed;
    await route.fulfill({ json: { instructions: "# Late draft" } }).catch(() => undefined);
  }, { times: 1 });
  await edit.getByRole("button", { name: "Draft instructions", exact: true }).click();
  await draft.getByLabel("Idea").fill("Revise the workflow.");
  const started = page.waitForRequest((request) => request.url().endsWith("/api/agents/draft-instructions"));
  await draft.getByRole("button", { name: "Generate draft" }).click();
  const pendingRequest = await started;
  await expect(draft.getByRole("status")).toHaveText("Generating draft…");
  const cancelled = page.waitForEvent("requestfailed", (request) => request === pendingRequest);
  await draft.getByRole("button", { name: "Discard draft" }).click();
  await cancelled;
  respond();
  await expect(preview).toHaveCount(0);
  await expect(instructions).toHaveValue(original!);

  const generateRevision = async () => {
    await edit.getByRole("button", { name: "Draft instructions", exact: true }).click();
    await draft.getByLabel("Idea").fill("Revise the workflow.");
    await draft.getByLabel("Include current instructions").check();
    await draft.getByRole("button", { name: "Generate draft" }).click();
    await expect(preview).toContainText("# Revised role");
  };
  await generateRevision();
  await draft.getByRole("button", { name: "Discard draft" }).click();
  await expect(instructions).toHaveValue(original!);
  await generateRevision();
  const revision = await preview.textContent();
  await expect(draft).toContainText("Using this draft replaces the text in Instructions.");
  await draft.getByRole("button", { name: "Use draft" }).click();
  await expect(instructions).toHaveValue(revision!);
  expect(readFileSync(file, "utf8")).toContain(original!);
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit.getByRole("status")).toHaveText("Saved");
  expect(readFileSync(file, "utf8")).toContain(revision!);
  await noOverflow(page);
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/vaults\/[^/]+$/);
  await expect(wiki.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await noOverflow(page);
});

test("seeds an explicit draft model, retries discovery and switches providers", async ({ page }) => {
  let discoveryCalls = 0;
  await page.route("**/api/providers/claude-code/models", (route) => {
    discoveryCalls++;
    if (discoveryCalls === 1) return route.fulfill({ status: 502, body: "Model discovery unavailable." });
    return route.fulfill({ json: {
      models: [
        { id: "sonnet", name: "Sonnet", free: false, images: true },
        { id: "haiku", name: "Haiku", free: false, images: true },
      ],
      defaultModel: "sonnet",
    } });
  });
  await page.route("**/api/agents/draft-instructions", (route) =>
    route.fulfill({ json: { instructions: "# Draft preview" } }));
  await page.goto("/agents/edit");
  const form = page.getByRole("form", { name: "New agent" });
  await form.getByRole("combobox", { name: "Provider", exact: true }).selectOption("claude-code");
  await form.getByRole("combobox", { name: "Model", exact: true }).fill("haiku");
  await form.getByRole("button", { name: "Draft instructions", exact: true }).click();
  const draft = page.getByRole("region", { name: "Draft instructions" });
  const provider = draft.getByRole("combobox", { name: "Draft provider" });
  const model = draft.getByRole("combobox", { name: "Draft model" });
  await expect(provider).toHaveValue("claude-code");
  await expect(draft.getByRole("alert")).toContainText("Model discovery unavailable.");
  expect(discoveryCalls).toBe(1);
  await draft.getByRole("button", { name: "Reload models" }).click();
  await expect(model).toHaveValue("haiku");
  expect(discoveryCalls).toBe(2);
  await provider.selectOption("replay");
  await expect(model).toHaveValue("");
  await expect(model).toBeDisabled();
  await provider.selectOption("claude-code");
  await expect(model).toHaveValue("");
  await model.selectOption("sonnet");
  await draft.getByLabel("Idea").fill("Review incident timelines.");
  const request = page.waitForRequest((request) => request.url().endsWith("/api/agents/draft-instructions"));
  await draft.getByRole("button", { name: "Generate draft" }).click();
  expect((await request).postDataJSON()).toMatchObject({ providerInstanceId: "claude-code", model: "sonnet" });
  await expect(draft.getByLabel("Draft preview")).toContainText("# Draft preview");
  expect(discoveryCalls).toBe(2);
  await noOverflow(page);
});

test("retries ordinary model suggestions when reselecting a provider", async ({ page }) => {
  let discoveryCalls = 0;
  await page.route("**/api/providers/claude-code/models", (route) => {
    discoveryCalls++;
    if (discoveryCalls === 1) return route.fulfill({ status: 502, body: "Model discovery unavailable." });
    return route.fulfill({ json: {
      models: [{ id: "haiku", name: "Haiku", free: false, images: true }],
      defaultModel: "haiku",
    } });
  });
  await page.goto("/agents/edit");
  const form = page.getByRole("form", { name: "New agent" });
  const provider = form.getByRole("combobox", { name: "Provider", exact: true });
  const failed = page.waitForResponse((response) =>
    response.url().endsWith("/api/providers/claude-code/models") && response.status() === 502);
  await provider.selectOption("claude-code");
  await failed;
  await provider.selectOption("replay");
  await provider.selectOption("claude-code");
  await expect(form.getByRole("combobox", { name: "Model", exact: true })).toHaveAttribute("placeholder", "The provider's default (haiku)");
  await expect(form.locator("datalist option[value='haiku']")).toHaveCount(1);
  expect(discoveryCalls).toBe(2);

  await provider.selectOption("replay");
  await provider.selectOption("claude-code");
  await form.getByRole("button", { name: "Draft instructions", exact: true }).click();
  const draft = page.getByRole("region", { name: "Draft instructions" });
  await expect(draft.getByRole("option", { name: "Haiku", exact: true })).toHaveCount(1);
  expect(discoveryCalls).toBe(2);
});

test("drafts with Codex and OpenCode using the selected model or provider default", async ({ page }) => {
  for (const [providerId, modelId, modelName] of [
    ["codex", "gpt-5.6-luna", "GPT-5.6 Luna"],
    ["opencode", "opencode/big-pickle", "Big Pickle"],
  ] as const) {
    await page.route("**/api/providers/" + providerId + "/models", (route) => route.fulfill({ json: {
      models: [{ id: modelId, name: modelName, free: false, images: false }],
      defaultModel: modelId,
    } }));
  }
  await page.route("**/api/agents/draft-instructions", (route) => {
    const { providerInstanceId } = route.request().postDataJSON();
    return route.fulfill({ json: { instructions: "# " + providerInstanceId + " draft" } });
  });
  await page.goto("/agents/edit");
  const form = page.getByRole("form", { name: "New agent" });
  await form.getByRole("combobox", { name: "Provider", exact: true }).selectOption("codex");
  await form.getByRole("combobox", { name: "Model", exact: true }).fill("gpt-5.6-luna");
  await form.getByRole("button", { name: "Draft instructions", exact: true }).click();
  const draft = form.getByRole("region", { name: "Draft instructions" });
  const provider = draft.getByRole("combobox", { name: "Draft provider" });
  const model = draft.getByRole("combobox", { name: "Draft model" });
  await expect(provider).toHaveValue("codex");
  await expect(model).toHaveValue("gpt-5.6-luna");
  await draft.getByLabel("Idea").fill("Draft a reviewer.");

  for (const [providerId, modelId] of [["codex", "gpt-5.6-luna"], ["opencode", null]] as const) {
    if (providerId === "opencode") {
      await provider.selectOption(providerId);
      await expect(model).toBeEnabled();
      await expect(model).toHaveValue("");
    }
    const request = page.waitForRequest((request) => request.url().endsWith("/api/agents/draft-instructions"));
    await draft.getByRole("button", { name: /Generate draft|Regenerate/ }).click();
    expect((await request).postDataJSON()).toMatchObject({ providerInstanceId: providerId, model: modelId });
    await expect(draft.getByLabel("Draft preview")).toHaveText("# " + providerId + " draft");
  }

  const instructions = form.getByRole("textbox", { name: "Instructions", exact: true });
  await expect(instructions).toHaveValue("");
  await draft.getByRole("button", { name: "Use draft" }).click();
  await expect(instructions).toHaveValue("# opencode draft");
  await expect(form.getByRole("combobox", { name: "Provider", exact: true })).toHaveValue("codex");
  await noOverflow(page);
});
