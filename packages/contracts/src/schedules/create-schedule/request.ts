import { Schema } from "effect";
import { MissedPolicy, Recurrence, ScheduleFields, ScheduleKind, ScheduleLink } from "../model.js";

/**
 * POST /api/schedules. Only `kind`, `text` and `recurrence` are required: the title
 * defaults to the text's first line, the timezone to the app's, a missed scheduled
 * prompt to `same-day`. A scheduled prompt needs a vault and gets its own thread.
 */
export const CreateScheduleRequest = Schema.Struct({
  kind: ScheduleKind,
  text: ScheduleFields.fields.text,
  recurrence: Recurrence,
  title: Schema.optionalKey(Schema.String),
  timezone: Schema.optionalKey(Schema.String),
  vaultId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  projectId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  agentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  providerInstanceId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  link: Schema.optionalKey(Schema.NullOr(ScheduleLink)),
  missed: Schema.optionalKey(MissedPolicy),
});
export type CreateScheduleRequest = typeof CreateScheduleRequest.Type;
