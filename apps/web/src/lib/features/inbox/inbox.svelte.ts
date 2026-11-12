import { InboxStreamMessage } from "@wiki-agents/contracts/inbox/event";
import { type InboxItem, isUnread } from "@wiki-agents/contracts/inbox/model";
import { errorMessage } from "#lib/api/client.ts";
import { listen } from "#lib/api/sse.ts";
import { dismissItem, INBOX_EVENTS_PATH, listInbox, markItemDone, markRead, snoozeItem } from "./api.ts";

const newestFirst = (a: InboxItem, b: InboxItem) => b.updatedAt - a.updatedAt;

/**
 * The one inbox, across agents, vaults and projects: loaded once and kept current by
 * GET /events/inbox, so the header's unread count is live on every page.
 */
class InboxStore {
  items = $state<ReadonlyArray<InboxItem>>([]);
  status = $state<"loading" | "loaded" | "failed">("loading");
  error = $state<string | null>(null);
  #close: (() => void) | undefined;

  /** Open and not snoozed: what the inbox shows. */
  get open() {
    return this.items.filter((item) => item.state === "open" && item.snoozedUntil === null).toSorted(newestFirst);
  }

  /** Hidden until their time comes; they come back unread. */
  get snoozed() {
    return this.items.filter((item) => item.state === "open" && item.snoozedUntil !== null).toSorted((a, b) => a.snoozedUntil! - b.snoozedUntil!);
  }

  /** Done or dismissed. */
  get history() {
    return this.items.filter((item) => item.state !== "open").toSorted(newestFirst);
  }

  get unread() {
    return this.items.filter(isUnread).length;
  }

  /** Loads the inbox and follows it; once for the app's life. */
  start() {
    if (this.#close !== undefined) return;
    this.#close = listen(INBOX_EVENTS_PATH, InboxStreamMessage, {
      onEvent: (message) => {
        if (message.type === "item.updated") this.upsert(message.item);
      },
      // Updates sent while disconnected are lost; reload.
      onReconnect: () => void this.load(),
    });
    void this.load();
  }

  stop() {
    this.#close?.();
    this.#close = undefined;
  }

  async load() {
    try {
      this.items = (await listInbox()).items;
      this.status = "loaded";
      this.error = null;
    } catch (error) {
      this.status = "failed";
      this.error = errorMessage(error, "Could not load the inbox");
    }
  }

  upsert(item: InboxItem) {
    this.items = this.items.some((existing) => existing.id === item.id)
      ? this.items.map((existing) => (existing.id === item.id ? item : existing))
      : [item, ...this.items];
  }

  /** You have seen these. */
  async read(itemIds: ReadonlyArray<string>) {
    const unread = itemIds.filter((id) => this.items.some((item) => item.id === id && !item.read));
    if (unread.length === 0) return;
    await this.#run(markRead(unread).then((response) => response.items.forEach((item) => this.upsert(item))), "Could not mark items read");
  }

  snooze(itemId: string, until: number) {
    return this.#run(snoozeItem(itemId, until).then((response) => this.upsert(response.item)), "Could not snooze");
  }

  dismiss(itemId: string) {
    return this.#run(dismissItem(itemId).then((response) => this.upsert(response.item)), "Could not dismiss");
  }

  done(itemId: string) {
    return this.#run(markItemDone(itemId).then((response) => this.upsert(response.item)), "Could not mark done");
  }

  async #run(action: Promise<void>, fallback: string) {
    try {
      await action;
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error, fallback);
    }
  }
}

export const inbox = new InboxStore();
