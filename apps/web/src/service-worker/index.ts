/**
 * Notifications with the app closed: shows each push, and opens its inbox item when
 * tapped (in an open window of the app if there is one). Caches nothing; the app
 * needs its server anyway.
 */

import { notificationFor, sameOriginPath } from "#lib/features/notifications/push-notification.ts";

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener("install", () => void sw.skipWaiting());
sw.addEventListener("activate", (event) => event.waitUntil(sw.clients.claim()));

sw.addEventListener("push", (event) => {
  const shown = notificationFor(event.data?.text() ?? null);
  event.waitUntil(sw.registration.showNotification(shown.title, shown.options));
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = sameOriginPath((event.notification.data as { url?: unknown } | null)?.url);
  const url = new URL(path, sw.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === sw.location.origin);
      if (open === undefined) return void (await sw.clients.openWindow(url));
      await open.focus();
      await open.navigate(url).catch(() => sw.clients.openWindow(url));
    })(),
  );
});
