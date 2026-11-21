import { Schema } from "effect";
import { InactivityPolicy } from "../inactivity-policy.js";

export const UpdateInactivityPolicyRequest = Schema.Struct({ policy: InactivityPolicy });
export type UpdateInactivityPolicyRequest = typeof UpdateInactivityPolicyRequest.Type;
