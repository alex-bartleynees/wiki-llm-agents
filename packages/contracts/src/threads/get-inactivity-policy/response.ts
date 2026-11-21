import { Schema } from "effect";
import { InactivityPolicy } from "../inactivity-policy.js";

export const GetInactivityPolicyResponse = Schema.Struct({ policy: InactivityPolicy });
export type GetInactivityPolicyResponse = typeof GetInactivityPolicyResponse.Type;
