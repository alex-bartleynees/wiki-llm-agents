import type { RecoverInstallRequest } from "@wiki-agents/contracts/skills/recover-install/request";
import type { ApplyInstallRequest } from "@wiki-agents/contracts/skills/apply-install/request";
import type { ImportSkillRequest } from "@wiki-agents/contracts/skills/import-skill/request";
import type { ListSkillsRequest } from "@wiki-agents/contracts/skills/list-skills/request";
import type { ReviewInstallRequest } from "@wiki-agents/contracts/skills/review-install/request";
import type { SaveSettingsRequest } from "@wiki-agents/contracts/skills/save-settings/request";
import type { SaveSkillRequest } from "@wiki-agents/contracts/skills/save-skill/request";
import type { Catalog, Detail, Review, Settings, SettingsPreview, SettingsView } from "@wiki-agents/contracts/skills/model";
import { Context, type Effect } from "effect";

export class Skills extends Context.Service<Skills, {
  settings(): Effect.Effect<typeof SettingsView.Type, unknown>;
  previewSettings(request: Settings): Effect.Effect<SettingsPreview, unknown>;
  configure(request: SaveSettingsRequest): Effect.Effect<typeof SettingsView.Type, unknown>;
  list(request: ListSkillsRequest): Effect.Effect<typeof Catalog.Type, unknown>;
  detail(request: { skillPath: string }): Effect.Effect<Detail, unknown>;
  save(request: SaveSkillRequest): Effect.Effect<Detail, unknown>;
  importFolder(request: ImportSkillRequest): Effect.Effect<Detail, unknown>;
  review(request: ReviewInstallRequest): Effect.Effect<Review, unknown>;
  recover(request: RecoverInstallRequest): Effect.Effect<Detail, unknown>;
  apply(request: ApplyInstallRequest): Effect.Effect<Detail, unknown>;
}>()("Skills") {}
