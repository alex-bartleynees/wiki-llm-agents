import type { RecoverInstallRequest } from "@wiki-agents/contracts/skills/recover-install/request";
import { Effect } from "effect";
import { Skills } from "../repository.js";

export const recoverInstall = Effect.fn("recoverInstall")(function* (request: RecoverInstallRequest) {
  const skills = yield* Skills;
  yield* skills.recover(request);
  return yield* skills.detail(request);
});
