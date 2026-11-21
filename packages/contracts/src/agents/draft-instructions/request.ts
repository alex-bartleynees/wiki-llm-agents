import { Schema } from "effect";

export const DRAFT_IDEA_MAX = 4000;
export const DRAFT_NAME_MAX = 200;
export const DRAFT_DESCRIPTION_MAX = 1000;
export const DRAFT_INSTRUCTIONS_MAX = 32000;

const requiredText = (max: number) => Schema.String.check(Schema.isMaxLength(max), Schema.isPattern(/\S/));
const optionalText = (max: number) => Schema.optionalKey(Schema.String.check(Schema.isMaxLength(max)));

export const DraftInstructionsRequest = Schema.Struct({
  providerInstanceId: requiredText(200),
  model: Schema.NullOr(requiredText(200)),
  idea: requiredText(DRAFT_IDEA_MAX),
  name: optionalText(DRAFT_NAME_MAX),
  description: optionalText(DRAFT_DESCRIPTION_MAX),
  currentInstructions: optionalText(DRAFT_INSTRUCTIONS_MAX),
});
export type DraftInstructionsRequest = typeof DraftInstructionsRequest.Type;
