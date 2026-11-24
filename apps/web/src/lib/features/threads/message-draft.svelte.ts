import { errorMessage } from "#lib/api/client.ts";
import { getDraft, saveDraft } from "./api.ts";

const SAVE_DELAY_MS = 300;

/** One composer lifetime. Writer + sequence makes rapid typing and unload writes order-independent. */
export class MessageDraft {
  text = $state("");
  loaded = $state(false);
  pending = $state(0);
  error = $state<string | null>(null);
  #writerId = crypto.randomUUID();
  #baseVersion = 0;
  #sequence = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #latest: Promise<boolean> = Promise.resolve(true);

  constructor(readonly threadId: string) {}

  async load() {
    this.loaded = false;
    this.error = null;
    try {
      const { draft } = await getDraft(this.threadId);
      this.#baseVersion = draft.version;
      this.#writerId = crypto.randomUUID();
      this.#sequence = 0;
      this.text = draft.text;
      this.loaded = true;
    } catch (error) {
      this.error = errorMessage(error, "Could not load draft");
    }
  }

  update(text: string) {
    this.text = text;
    if (!this.loaded) return;
    this.#sequence++;
    this.error = null;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async sent() {
    this.text = "";
    await this.load();
  }

  #save() {
    const text = this.text;
    const sequence = this.#sequence;
    this.pending++;
    this.#latest = saveDraft(this.threadId, { text, writerId: this.#writerId, baseVersion: this.#baseVersion, sequence }).then(
      () => true,
      (error: unknown) => {
        if (sequence === this.#sequence) this.error = errorMessage(error, "Could not save draft");
        return false;
      },
    ).finally(() => this.pending--);
  }

  /** Save queued text immediately and wait for the latest write. */
  flush() {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#save();
    }
    return this.#latest;
  }

  retry() {
    if (this.loaded) {
      this.update(this.text);
      void this.flush();
    } else void this.load();
  }
}
