import type { SaveSkillRequest } from "@wiki-agents/contracts/skills/save-skill/request";
import { Effect } from "effect";
import { Skills } from "../repository.js";

const template = (name: string) => `---\nname: ${JSON.stringify(name)}\ndescription: Describe when to use this skill.\n---\n\n# ${name}\n\nWrite the skill instructions here.\n`;

export const saveSkill = Effect.fn("saveSkill")(function* ({ skillPath, content, baseHash }: SaveSkillRequest) {
  const skills = yield* Skills;
  if (baseHash === null) yield* skills.create(skillPath, content === "" ? template(skillPath.split("/").at(-1)!) : content);
  else yield* skills.update(skillPath, content, baseHash);
  return yield* skills.detail({ skillPath });
});
