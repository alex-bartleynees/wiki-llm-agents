import { Effect, Layer } from "effect";
import { runDigest } from "./digest.js";

/** The morning digest, for the server's life. */
export const NotificationsStartup = Layer.effectDiscard(Effect.forkScoped(runDigest));
