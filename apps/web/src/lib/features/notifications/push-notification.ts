import { INBOX_PATH } from "@wiki-agents/contracts/inbox/model";
import { PushPayload } from "@wiki-agents/contracts/notifications/model";
import { Schema } from "effect";

/**
 * What the service worker shows for a push, and where tapping it goes. Pure, so it is
 * tested without a service worker.
 */

export interface ShownNotification {
  readonly title: string;
  readonly options: NotificationOptions & { readonly data: { readonly url: string } };
}

const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(PushPayload));

/** The notification for a push's text; a push we can't read still says something arrived. */
export const notificationFor = (text: string | null): ShownNotification => {
  const payload = text === null ? undefined : decodePayload(text);
  const shown = payload?._tag === "Some" ? payload.value : { title: "wiki-agents", body: "Something new in your inbox.", url: INBOX_PATH, tag: "inbox" };
  return {
    title: shown.title,
    options: {
      body: shown.body,
      tag: shown.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: sameOriginPath(shown.url) },
    },
  };
};

/** Only paths in this app: a payload never sends you somewhere else. */
export const sameOriginPath = (url: unknown) => (typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : INBOX_PATH);
