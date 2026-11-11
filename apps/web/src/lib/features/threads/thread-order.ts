import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";

/** Most recently updated first. */
export const byRecent = (a: ThreadSummary, b: ThreadSummary) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt;
/** Most recently marked done first. */
const byDone = (a: ThreadSummary, b: ThreadSummary) => (b.doneAt ?? 0) - (a.doneAt ?? 0) || byRecent(a, b);

/** Threads not marked done, in the order given. */
export const openThreads = (threads: ReadonlyArray<ThreadSummary>) => threads.filter((thread) => thread.doneAt === null);
/** Threads marked done, most recently marked first. */
export const doneThreads = (threads: ReadonlyArray<ThreadSummary>) => threads.filter((thread) => thread.doneAt !== null).sort(byDone);
