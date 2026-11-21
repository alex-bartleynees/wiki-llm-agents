import { Schema } from "effect";
import { InactivityPolicy } from "../inactivity-policy.js";

export const UpdateInactivityPolicyResponse = Schema.Struct({ policy: InactivityPolicy });
export type UpdateInactivityPolicyResponse = typeof UpdateInactivityPolicyResponse.Type;
