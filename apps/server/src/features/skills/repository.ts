import type { Catalog, Detail, InstallAction, Review, Settings, SettingsPreview, SettingsView } from "@wiki-agents/contracts/skills/model";
import type { SaveSettingsRequest } from "@wiki-agents/contracts/skills/save-settings/request";
import { Context, type Effect } from "effect";
import type { SkillError } from "./errors.js";

export interface InstallPlan {
  readonly review: Review;
  readonly apply: Effect.Effect<void, SkillError>;
}

interface InstallLocation {
  readonly skillPath: string;
  readonly destination: string;
}

export class Skills extends Context.Service<Skills, {
  settings(): Effect.Effect<typeof SettingsView.Type, SkillError>;
  previewSettings(request: Settings): Effect.Effect<SettingsPreview, SkillError>;
  configure(request: SaveSettingsRequest): Effect.Effect<typeof SettingsView.Type, SkillError>;
  list(): Effect.Effect<typeof Catalog.Type, SkillError>;
  detail(request: { readonly skillPath: string }): Effect.Effect<Detail, SkillError>;
  create(skillPath: string, content: string): Effect.Effect<void, SkillError>;
  update(skillPath: string, content: string, baseHash: string): Effect.Effect<void, SkillError>;
  importFolder(path: string): Effect.Effect<string, SkillError>;
  plan(request: InstallLocation & { readonly action: InstallAction }): Effect.Effect<InstallPlan, SkillError>;
  recover(request: InstallLocation): Effect.Effect<void, SkillError>;
}>()("Skills") {}
