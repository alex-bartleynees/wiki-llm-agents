import type { ApplyInstallRequest } from "@wiki-agents/contracts/skills/apply-install/request";
import { Effect } from "effect";
import { SkillConflict } from "../errors.js";
import { Skills } from "../skills.js";

export const applyInstall = Effect.fn("applyInstall")(function* (request: ApplyInstallRequest) {
  const skills = yield* Skills;
  const plan = yield* skills.plan(request);
  if (plan.review.token !== request.token) return yield* new SkillConflict({ message: "The files changed since review. Review the new diff." });
  yield* plan.apply;
  return yield* skills.detail(request);
});
