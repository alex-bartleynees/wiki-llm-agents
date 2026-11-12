import { type InboxItem, type InboxItemKind, inboxItemHref } from "@wiki-agents/contracts/inbox/model";
import type { NotificationPreferences, PushPayload, PushRoute, PushRoutes } from "@wiki-agents/contracts/notifications/model";

/**
 * Which items notify your devices, and what a notification says. Pure, so the
 * routing rules are tested on their own.
 */

const GROUPS: Record<Exclude<InboxItemKind, "digest">, keyof PushRoutes> = {
  reminder: "reminders",
  "prompt.missed": "reminders",
  request: "requests",
  "prompt.result": "results",
  "prompt.failed": "results",
  "turn.finished": "turns",
  "turn.failed": "turns",
};

/** What a notification says about an item when previews are private. */
const PRIVATE_BODIES: Record<InboxItemKind, string> = {
  reminder: "A reminder is due.",
  "prompt.missed": "A scheduled prompt was missed.",
  request: "An agent is waiting for you.",
  "prompt.result": "A scheduled prompt has an answer.",
  "prompt.failed": "A scheduled prompt failed.",
  "turn.finished": "A thread's turn finished.",
  "turn.failed": "A thread's turn failed.",
  digest: "Your digest is ready.",
};

export type Decision = { readonly _tag: "send"; readonly urgent: boolean } | { readonly _tag: "hold" } | { readonly _tag: "skip"; readonly reason: string };

const GROUP_LABELS: Record<keyof PushRoutes, string> = {
  reminders: "reminders",
  requests: "requests",
  results: "scheduled prompts",
  turns: "turns",
};

/**
 * Send now, hold for the digest, or skip. The digest itself always goes out (it is
 * what was held). Items handled before their delivery (an answered request) are
 * skipped.
 */
export const decide = (item: InboxItem, preferences: NotificationPreferences): Decision => {
  if (preferences.muted) return { _tag: "skip", reason: "Notifications are muted." };
  if (item.state !== "open") return { _tag: "skip", reason: "Handled before it was sent." };
  if (item.kind === "digest") return { _tag: "send", urgent: false };
  const group = GROUPS[item.kind];
  const route: PushRoute = preferences.routes[group];
  if (route === "off") return { _tag: "skip", reason: `Notifications are off for ${GROUP_LABELS[group]}.` };
  if (route === "digest") return { _tag: "hold" };
  return { _tag: "send", urgent: group === "reminders" || group === "requests" };
};

const TITLE_LIMIT = 120;
const BODY_LIMIT = 400;

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`);

/** Markdown as a line of plain text, for a notification's few lines. */
export const plainText = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const APP_NAME = "wiki-agents";

/** The notification for an item: its title and text, or only its kind when previews are private. */
export const payloadFor = (item: InboxItem, preferences: Pick<NotificationPreferences, "privatePreviews">): PushPayload => ({
  title: preferences.privatePreviews ? APP_NAME : clip(item.title, TITLE_LIMIT),
  body: preferences.privatePreviews ? PRIVATE_BODIES[item.kind] : clip(plainText(item.body), BODY_LIMIT),
  url: inboxItemHref(item.id),
  tag: item.id,
});

/** The digest item's text: one line per held item. */
export const digestItem = (items: ReadonlyArray<{ readonly kind: string; readonly title: string }>) => ({
  kind: "digest" as const,
  title: items.length === 1 ? "Digest: 1 item" : `Digest: ${items.length} items`,
  body: items.map((item) => `• ${item.title}`).join("\n"),
  source: {},
});
