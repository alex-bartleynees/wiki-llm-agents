import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";

/** The agent's last message in the turn (its answer), from the turn's events; empty when it said nothing. */
export const finalReply = (events: ReadonlyArray<ThreadEvent>, turnId: string) => {
  let messageId: string | undefined;
  let text = "";
  for (const event of events) {
    if (event._tag !== "message.delta" || event.turnId !== turnId) continue;
    if (event.messageId !== messageId) {
      messageId = event.messageId;
      text = "";
    }
    text += event.text;
  }
  return text.trim();
};

/** The turn's notices, e.g. what an unattended turn was refused. */
export const turnNotices = (events: ReadonlyArray<ThreadEvent>, turnId: string) =>
  events.flatMap((event) => (event._tag === "notice" && event.turnId === turnId ? [event.text] : []));
