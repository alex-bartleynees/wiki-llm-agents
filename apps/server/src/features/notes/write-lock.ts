import { Context, Layer, Semaphore } from "effect";

/** Serializes note saves across editors and agent turns, including their hash check. */
export class NoteWriteLock extends Context.Service<NoteWriteLock, Semaphore.Semaphore>()("NoteWriteLock") {}
export const NoteWriteLockLive = Layer.sync(NoteWriteLock, () => Semaphore.makeUnsafe(1));
