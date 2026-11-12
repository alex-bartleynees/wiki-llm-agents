import { Data } from "effect";

export class InboxItemNotFound extends Data.TaggedError("InboxItemNotFound")<{ readonly itemId: string }> {}

/** Snoozing until a time that has already passed. */
export class InvalidSnooze extends Data.TaggedError("InvalidSnooze")<{ readonly message: string }> {}
