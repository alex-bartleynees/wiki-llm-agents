import { readFileSync } from "node:fs";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import webpush from "web-push";
import { AppConfig } from "../../shared/config.js";
import { NotificationsRepository, type PushTarget, type VapidKeyPair } from "./repository.js";

/**
 * The push service didn't take the notification. `status` is its HTTP status (null
 * when it couldn't be reached); 404 and 410 mean the subscription is gone.
 */
export class PushRejected extends Data.TaggedError("PushRejected")<{ readonly status: number | null; readonly message: string }> {}

export const isExpired = (error: PushRejected) => error.status === 404 || error.status === 410;

export interface PushOptions {
  /** How long the push service keeps it for an offline device, in seconds. */
  readonly ttl: number;
  readonly urgency: "normal" | "high";
}

/** Sends one encrypted notification to one subscription's push service. */
export interface PushSenderService {
  readonly publicKey: string;
  readonly send: (target: PushTarget, payload: string, options: PushOptions) => Effect.Effect<void, PushRejected>;
}

export class PushSender extends Context.Service<PushSender, PushSenderService>()("PushSender") {}

/** How long a push service has to answer. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Why a request didn't get an answer. `fetch` says only "fetch failed"; the reason
 * (DNS, refused, blocked, timed out) is in its `cause` chain.
 */
export const networkReason = (error: unknown): string => {
  const parts: Array<string> = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      const text = current.name === "TimeoutError" ? "timed out" : current.message;
      parts.push(typeof code === "string" && !text.includes(code) ? `${text} (${code})` : text);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(": ");
};

const KeyFile = Schema.fromJsonString(Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String }));

/** The VAPID key pair: from the secrets file when one is configured, otherwise kept in the database. */
const vapidKeys = Effect.gen(function* () {
  const file = yield* AppConfig.vapidKeysFile;
  if (Option.isSome(file)) {
    const text = yield* Effect.try({
      try: () => readFileSync(file.value, "utf8"),
      catch: (cause) => new Error(`Can't read the VAPID keys file ${file.value}: ${String(cause)}`),
    });
    return yield* Effect.mapError(Schema.decodeUnknownEffect(KeyFile)(text), (cause) => new Error(`The VAPID keys file ${file.value} isn't valid: ${cause.message}`));
  }
  const repository = yield* NotificationsRepository;
  return yield* repository.vapidKeys((): VapidKeyPair => webpush.generateVAPIDKeys());
});

/**
 * Web Push over `fetch`: `web-push` signs (VAPID) and encrypts (aes128gcm) the
 * request, and we send it, so any endpoint works, including a plain-HTTP one in tests.
 */
export const PushSenderLive = Layer.effect(
  PushSender,
  Effect.gen(function* () {
    const keys = yield* vapidKeys;
    const subject = yield* AppConfig.vapidSubject;
    const vapidDetails = { subject, publicKey: keys.publicKey, privateKey: keys.privateKey };

    const send = (target: PushTarget, payload: string, options: PushOptions) =>
      Effect.gen(function* () {
        const request = yield* Effect.try({
          try: () =>
            webpush.generateRequestDetails({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
              vapidDetails,
              TTL: options.ttl,
              urgency: options.urgency,
              contentEncoding: "aes128gcm",
            }),
          catch: (cause) => new PushRejected({ status: null, message: `Can't encrypt for this device: ${String(cause)}` }),
        });
        const response = yield* Effect.tryPromise({
          try: (signal) =>
            fetch(request.endpoint, {
              method: request.method,
              headers: request.headers,
              body: request.body,
              signal: AbortSignal.any([signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]),
            }),
          catch: (cause) => new PushRejected({ status: null, message: `Can't reach the push service: ${networkReason(cause)}` }),
        });
        if (response.ok) return;
        const text = yield* Effect.promise(() => response.text().catch(() => ""));
        const detail = text.trim().slice(0, 200);
        return yield* new PushRejected({
          status: response.status,
          message: `The push service answered ${response.status}${detail === "" ? "" : `: ${detail}`}`,
        });
      });

    return PushSender.of({ publicKey: keys.publicKey, send });
  }),
);
