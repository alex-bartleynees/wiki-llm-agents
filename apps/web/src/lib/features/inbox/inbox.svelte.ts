import { InboxStreamMessage } from "@wiki-agents/contracts/inbox/event";
import type { MarkAllDoneTarget } from "@wiki-agents/contracts/inbox/mark-all-done/request";
import { type InboxItem, isUnread } from "@wiki-agents/contracts/inbox/model";
import { errorMessage } from "#lib/api/client.ts";
import { listen } from "#lib/api/sse.ts";
import { dismissItem, INBOX_TOPIC, listInbox, markAllDone, markItemDone, markRead, snoozeItem } from "./api.ts";

const newestFirst = (a: InboxItem, b: InboxItem) => b.updatedAt - a.updatedAt;

const reconcileItem = (current: InboxItem | undefined, incoming: InboxItem): InboxItem => {
  if (current === undefined || incoming.updatedAt > current.updatedAt) return incoming;
  if (incoming.updatedAt < current.updatedAt) return current;

  // Delivery receipts advance independently of the item timestamp. Requeuing
  // resets attempts together with a new item timestamp.
  const deliveries = new Map(current.deliveries.map((delivery) => [delivery.channel, delivery]));
  let advanced = false;
  for (const delivery of incoming.deliveries) {
    const previous = deliveries.get(delivery.channel);
    if (previous !== undefined && previous.attempts >= delivery.attempts) continue;
    deliveries.set(delivery.channel, delivery);
    advanced = true;
  }
  return advanced ? { ...current, deliveries: [...deliveries.values()] } : current;
};

/**
 * The one inbox, across agents, vaults and projects: loaded once and kept current by
 * the inbox topic on the event stream, so the header's unread count is live on every page.
 */
class InboxStore {
  items = $state<ReadonlyArray<InboxItem>>([]);
  status = $state<"loading" | "loaded" | "failed">("loading");
  error = $state<string | null>(null);
  completing = $state(false);
  #loadUpdates: Map<string, InboxItem> | undefined;
  #loaded = 0;
  #close: (() => void) | undefined;

  /** Open and not snoozed: what the inbox shows. */
  get open() {
    return this.items.filter((item) => item.state === "open" && item.snoozedUntil === null).toSorted(newestFirst);
  }

  get eligible() {
    return this.open.filter((item) => item.kind !== "request");
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
    let subscribed = false;
    this.#close = listen(INBOX_TOPIC, InboxStreamMessage, {
      onEvent: (message) => {
        if (message.type === "item.updated") this.#merge([message.item]);
        // A first load can finish before the topic subscribes.
        if (message.type === "ready" && !subscribed) {
          subscribed = true;
          void this.load();
        }
      },
      // Updates sent while disconnected are lost; reload.
      onReconnect: () => void this.load(),
    });
    void this.load();
  }

  stop() {
    this.#close?.();
    this.#close = undefined;
    this.#loadUpdates = undefined;
  }

  async load() {
    const updates = new Map<string, InboxItem>();
    this.#loadUpdates = updates;
    this.status = "loading";
    try {
      const { items } = await listInbox();
      if (this.#loadUpdates !== updates) return;
      const current = new Map(this.items.map((item) => [item.id, item]));
      const snapshot = new Map(items.map((item) => [item.id, reconcileItem(current.get(item.id), item)]));
      // Keep updates received during the fetch, including arrivals absent from its snapshot.
      for (const [id, item] of updates) {
        snapshot.set(id, reconcileItem(snapshot.get(id), item));
      }
      this.items = [...snapshot.values()];
      this.#loaded++;
      this.status = "loaded";
      this.error = null;
    } catch (error) {
      if (this.#loadUpdates !== updates) return;
      this.status = "failed";
      this.error = errorMessage(error, "Could not load the inbox");
    } finally {
      if (this.#loadUpdates === updates) this.#loadUpdates = undefined;
    }
  }

  #merge(changed: ReadonlyArray<InboxItem>, loaded = this.#loaded) {
    const current = new Map(this.items.map((item) => [item.id, item]));
    const arrivalIds: string[] = [];
    let merged = false;
    for (const item of changed) {
      const previous = current.get(item.id);
      // A reload can drop old history while a mutation response is in flight.
      if (previous === undefined && loaded !== this.#loaded) continue;
      const next = reconcileItem(previous, item);
      if (next === previous) continue;
      if (previous === undefined) arrivalIds.push(item.id);
      current.set(item.id, next);
      this.#loadUpdates?.set(item.id, next);
      merged = true;
    }
    if (merged) {
      this.items = [...arrivalIds.map((id) => current.get(id)!), ...this.items.map(({ id }) => current.get(id)!)];
    }
  }

  /** You have seen these. */
  async read(itemIds: ReadonlyArray<string>) {
    const seen = new Set(itemIds);
    const unread = this.open.filter((item) => !item.read && seen.has(item.id));
    if (unread.length === 0) return;
    const loaded = this.#loaded;
    await this.#run((async () => {
      for (let offset = 0; offset < unread.length; offset += 500) {
        const ids = unread.slice(offset, offset + 500).map((item) => item.id);
        this.#merge((await markRead(ids)).items, loaded);
      }
    })(), "Could not mark items read");
  }

  async completeAll(targets: ReadonlyArray<MarkAllDoneTarget>) {
    this.completing = true;
    const loaded = this.#loaded;
    try {
      const { items } = await markAllDone({ targets });
      this.#merge(items, loaded);
      return items.length;
    } finally {
      this.completing = false;
    }
  }

  snooze(itemId: string, until: number) {
    const loaded = this.#loaded;
    return this.#run(snoozeItem(itemId, until).then((response) => this.#merge([response.item], loaded)), "Could not snooze");
  }

  dismiss(itemId: string) {
    const loaded = this.#loaded;
    return this.#run(dismissItem(itemId).then((response) => this.#merge([response.item], loaded)), "Could not dismiss");
  }

  done(itemId: string) {
    const loaded = this.#loaded;
    return this.#run(markItemDone(itemId).then((response) => this.#merge([response.item], loaded)), "Could not mark done");
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
