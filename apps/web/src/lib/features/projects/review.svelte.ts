import { sendMessage } from "#lib/features/threads/api.ts";
import { type ReviewComment, reviewMessage } from "./review-message.ts";

/** Draft comments, per project, kept on this device until sent. */
const key = (projectId: string) => `wiki-agents:review:${projectId}`;

const stored = (projectId: string): ReadonlyArray<ReviewComment> => {
  try {
    const value = JSON.parse(localStorage.getItem(key(projectId)) ?? "[]") as unknown;
    return Array.isArray(value) ? (value as ReadonlyArray<ReviewComment>) : [];
  } catch {
    return [];
  }
};

/**
 * A project's review: comments on lines of its diff, drafted in the browser and sent
 * to one of its threads as one message. Nothing is stored on the server; the sent
 * message is the record.
 */
class ReviewDrafts {
  #byProject = $state<Record<string, ReadonlyArray<ReviewComment>>>({});

  comments(projectId: string): ReadonlyArray<ReviewComment> {
    return this.#byProject[projectId] ?? stored(projectId);
  }

  add(projectId: string, comment: Omit<ReviewComment, "id">) {
    this.#set(projectId, [...this.comments(projectId), { ...comment, id: crypto.randomUUID() }]);
  }

  remove(projectId: string, id: string) {
    this.#set(projectId, this.comments(projectId).filter((comment) => comment.id !== id));
  }

  clear(projectId: string) {
    this.#set(projectId, []);
  }

  /** Posts every comment to the thread as one message, then drops them; on failure they stay. */
  async send(projectId: string, workingDirectories: ReadonlyArray<string>, threadId: string) {
    const comments = this.comments(projectId);
    if (comments.length === 0) return;
    await sendMessage(threadId, reviewMessage(workingDirectories, comments));
    const sent = new Set(comments.map((comment) => comment.id));
    this.#set(projectId, this.comments(projectId).filter((comment) => !sent.has(comment.id)));
  }

  #set(projectId: string, comments: ReadonlyArray<ReviewComment>) {
    this.#byProject[projectId] = comments;
    try {
      if (comments.length === 0) localStorage.removeItem(key(projectId));
      else localStorage.setItem(key(projectId), JSON.stringify(comments));
    } catch {
      // Private mode or full storage: the drafts last until the page closes.
    }
  }
}

export const review = new ReviewDrafts();
