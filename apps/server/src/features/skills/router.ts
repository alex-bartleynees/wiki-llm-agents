import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { getSettingsEndpoint } from "./get-settings/endpoint.js";
import { saveSettingsEndpoint } from "./save-settings/endpoint.js";
import { listSkillsEndpoint } from "./list-skills/endpoint.js";
import { getSkillEndpoint } from "./get-skill/endpoint.js";
import { saveSkillEndpoint } from "./save-skill/endpoint.js";
import { importSkillEndpoint } from "./import-skill/endpoint.js";
import { previewSettingsEndpoint } from "./preview-settings/endpoint.js";
import { reviewInstallEndpoint } from "./review-install/endpoint.js";
import { recoverInstallEndpoint } from "./recover-install/endpoint.js";
import { applyInstallEndpoint } from "./apply-install/endpoint.js";

export const skillsRouter = Layer.mergeAll(
  HttpRouter.add("GET", "/api/skills/settings", getSettingsEndpoint),
  HttpRouter.add("PUT", "/api/skills/settings", saveSettingsEndpoint),
  HttpRouter.add("POST", "/api/skills/settings/preview", previewSettingsEndpoint),
  HttpRouter.add("GET", "/api/skills", listSkillsEndpoint),
  HttpRouter.add("GET", "/api/skills/detail", getSkillEndpoint),
  HttpRouter.add("PUT", "/api/skills/detail", saveSkillEndpoint),
  HttpRouter.add("POST", "/api/skills/import", importSkillEndpoint),
  HttpRouter.add("POST", "/api/skills/review", reviewInstallEndpoint),
  HttpRouter.add("POST", "/api/skills/apply", applyInstallEndpoint),
  HttpRouter.add("POST", "/api/skills/recover", recoverInstallEndpoint),
);
