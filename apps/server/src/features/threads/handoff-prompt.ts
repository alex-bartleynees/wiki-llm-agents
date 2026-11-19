/**
 * What the app asks the thread's agent when you ask for a handoff (Phase 3 of
 * provider context and compaction). The reply is a draft you review before it starts a
 * new thread with a fresh provider session, so it must stand on its own: that thread
 * won't see this conversation. The headings match the template the web app offers
 * for writing a handoff yourself.
 */
export const HANDOFF_PROMPT = `Write a handoff so this work can carry on in a new conversation that won't see this one.

Use exactly these headings, in this order, as markdown "##" headings:
## Objective
## Decisions
## Files changed
## Checks run
## Unfinished work
## Relevant paths

Be concise and specific: exact file paths, commands, ids, names and open issues, so someone new can pick it up without asking. Write "None" under a heading with nothing to say. Answer from this conversation alone: don't use tools, run commands or change any files. Reply with the handoff only, nothing before or after it.`;
