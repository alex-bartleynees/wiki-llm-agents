import { getThread } from "./api.ts";
import { projects } from "#lib/features/projects/projects.svelte.ts";
import { shell } from "#lib/ui/layout/shell.svelte.ts";
import { threads } from "./threads.svelte.ts";

/** The query parameter that opens a thread on a vault's page: `/vaults/<id>?thread=<id>`. */
export const THREAD_PARAM = "thread";

/** Where a thread opens from elsewhere in the app (the inbox): its vault, with the thread shown. */
export const threadHref = (vaultId: string, threadId: string) =>
  `/vaults/${encodeURIComponent(vaultId)}?${THREAD_PARAM}=${encodeURIComponent(threadId)}`;

/**
 * Shows the thread: its project's threads (or the vault's), with it open, and the
 * chat screen on a phone.
 */
export const showThread = async (threadId: string) => {
  const { thread } = await getThread(threadId);
  projects.select(thread.projectId);
  await threads.show({ vaultId: thread.vaultId, projectId: thread.projectId }, thread.id);
  shell.sidePane = "threads";
  shell.tab = "chat";
};
