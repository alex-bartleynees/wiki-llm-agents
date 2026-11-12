/**
 * This browser's side of Web Push: whether it can, the permission, and its
 * subscription (through the service worker SvelteKit registers). Kept apart so the
 * store's tests can stand in for it.
 */

/**
 * - `supported`: notifications can be turned on here
 * - `insecure`: the page isn't HTTPS (or localhost), so browsers won't allow it
 * - `install-first`: iPhone and iPad allow it only from the app on the Home Screen
 * - `unsupported`: this browser has no Web Push
 */
export type PushSupport = "supported" | "insecure" | "install-first" | "unsupported";

const isAppleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export const pushSupport = (): PushSupport => {
  if (!window.isSecureContext) return "insecure";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isAppleMobile() && !standalone()) return "install-first";
  return supported ? "supported" : "unsupported";
};

export const permission = (): NotificationPermission => ("Notification" in window ? Notification.permission : "denied");

/** How long to wait for the service worker before giving up. */
const READY_TIMEOUT_MS = 10_000;

/** Where SvelteKit serves the service worker (a module script in dev). */
const SCRIPT = "/service-worker.js";

/**
 * Kit registers the worker on load but drops any error, so a failed registration
 * would only time out. Registering again (a no-op when it worked) says why it didn't.
 */
const ensureRegistered = async () => {
  if ((await navigator.serviceWorker.getRegistration()) !== undefined) return;
  try {
    await navigator.serviceWorker.register(SCRIPT, import.meta.env.DEV ? { type: "module" } : {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A proxy that sends requests without its login cookie to a login page (exe.dev, Cloudflare Access...).
    if (/redirect/i.test(message)) {
      throw new Error(`The service worker couldn't load: something in front of the app redirects ${SCRIPT} (a proxy's login page?). Browsers don't follow redirects for it, so it has to be served directly`);
    }
    throw new Error(`The service worker couldn't load: ${message}`);
  }
};

const registration = async () => {
  await ensureRegistered();
  const ready = navigator.serviceWorker.ready;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("The service worker didn't start; reload and try again")), READY_TIMEOUT_MS),
  );
  return Promise.race([ready, timeout]);
};

const fromBase64Url = (text: string) => {
  const base64 = (text + "=".repeat((4 - (text.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};

export interface BrowserSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

const toJson = (subscription: PushSubscription): BrowserSubscription => {
  const json = subscription.toJSON();
  if (json.endpoint === undefined || json.keys?.["p256dh"] === undefined || json.keys["auth"] === undefined) {
    throw new Error("The browser's subscription has no keys");
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys["p256dh"], auth: json.keys["auth"] } };
};

/** Asks for permission (once), then subscribes with the server's key. */
export const subscribe = async (publicKey: string): Promise<BrowserSubscription> => {
  const granted = await Notification.requestPermission();
  if (granted !== "granted") throw new Error("Notifications are blocked for this site; allow them in the browser's site settings");
  const pushManager = (await registration()).pushManager;
  const existing = await pushManager.getSubscription();
  if (existing !== null) return toJson(existing);
  try {
    return toJson(await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) }));
  } catch (error) {
    // Chromium without Google's push service (Brave with it off, ungoogled or keyless builds) fails here.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`This browser couldn't reach its push service (${error.message}). In Brave, turn on "Use Google services for push messaging"; Chromium builds without Google services can't get notifications, so try Chrome, Firefox or Edge`);
    }
    throw error;
  }
};

/** This browser's subscription, if it has one. */
export const currentSubscription = async (): Promise<BrowserSubscription | null> => {
  const found = await navigator.serviceWorker.getRegistration();
  const subscription = await found?.pushManager.getSubscription();
  return subscription == null ? null : toJson(subscription);
};

export const unsubscribe = async () => {
  const found = await navigator.serviceWorker.getRegistration();
  await (await found?.pushManager.getSubscription())?.unsubscribe();
};

/** "Chrome on Android", "Safari on iPhone"...; a name to tell devices apart. */
export const deviceName = (userAgent = navigator.userAgent) => {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  return os === null ? browser : `${browser} on ${os}`;
};
