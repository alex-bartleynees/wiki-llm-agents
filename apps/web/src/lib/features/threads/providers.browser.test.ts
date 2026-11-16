import { expect, it, vi } from "vitest";

vi.mock("./api.ts", () => ({
  listProviders: vi.fn(),
  getProviderStatus: vi.fn(async () => ({ status: { _tag: "ready", version: "test", account: null } })),
}));
const { providers } = await import("./providers.svelte.ts");

it("keeps explicit models with their provider and permits returning to the default", () => {
  const capabilities = { interrupt: true, resume: false, approvals: true, questions: true, models: true, images: true };
  providers.list = [
    { id: "one", name: "One", kind: "claude-code", capabilities },
    { id: "two", name: "Two", kind: "codex", capabilities },
  ];
  providers.choose("one");
  providers.chooseModel("haiku");
  providers.choose("two");
  expect(providers.model).toBe("");
  providers.chooseModel("codex-model");
  providers.choose("one");
  expect(providers.model).toBe("haiku");
  providers.chooseModel("");
  expect(providers.model).toBe("");
  providers.choose("two");
  expect(providers.model).toBe("codex-model");
});
