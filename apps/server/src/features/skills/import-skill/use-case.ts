import type { ImportSkillRequest } from "@wiki-agents/contracts/skills/import-skill/request";
import { Effect } from "effect";
import { Skills } from "../repository.js";

export const importSkill = Effect.fn("importSkill")(function* ({ path }: ImportSkillRequest) {
  const skills = yield* Skills;
  const skillPath = yield* skills.importFolder(path);
  return yield* skills.detail({ skillPath });
});
