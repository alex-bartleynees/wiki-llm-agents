import { ApiError, errorMessage } from "#lib/api/client.ts";
import { agents } from "./agents.svelte.ts";
import { deleteRules, getRules, saveRules } from "./api.ts";
import { isValidId } from "./agent-form.ts";

export interface RulesVersion {
  readonly content: string;
  readonly hash: string;
}

/** The file changed on disk since the edit started; `disk` is null when it was deleted. */
export interface RulesConflict {
  readonly disk: RulesVersion | null;
}

/** One rules file being edited (or created, with `rulesId` null), saved explicitly and hash-checked. */
export class RulesEditor {
  savedId = $state<string | null>(null);
  id = $state("");
  content = $state("");
  status = $state<"loading" | "ready" | "missing" | "failed">("ready");
  loadError = $state<string | undefined>(undefined);
  saving = $state(false);
  problems = $state<ReadonlyArray<string>>([]);
  conflict = $state<RulesConflict | null>(null);
  base = $state<RulesVersion | null>(null);

  constructor(rulesId: string | null) {
    if (rulesId !== null) {
      this.savedId = rulesId;
      this.id = rulesId;
      this.status = "loading";
    }
  }

  get isNew() {
    return this.savedId === null;
  }

  get dirty() {
    return this.content !== (this.base?.content ?? "");
  }

  async load() {
    if (this.savedId === null) return;
    try {
      const version = await this.#read(this.savedId);
      if (version === null) {
        this.status = "missing";
        return;
      }
      this.base = version;
      this.content = version.content;
      this.status = "ready";
    } catch (error) {
      this.status = "failed";
      this.loadError = errorMessage(error, "Couldn't load the rules");
    }
  }

  save() {
    return this.#save(this.base?.hash ?? null);
  }

  keepMine() {
    return this.#save(this.conflict?.disk?.hash ?? null);
  }

  useDisk() {
    const disk = this.conflict?.disk;
    if (disk === undefined) return;
    if (disk === null) {
      this.base = null;
      this.savedId = null;
    } else {
      this.base = disk;
      this.content = disk.content;
    }
    this.conflict = null;
    this.problems = [];
  }

  async remove() {
    if (this.savedId === null || this.base === null) return false;
    this.saving = true;
    try {
      await deleteRules(this.savedId, this.base.hash);
      void agents.refresh();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await this.#conflicted();
      else this.problems = [errorMessage(error, "Couldn't delete the rules")];
      return false;
    } finally {
      this.saving = false;
    }
  }

  async #save(baseHash: string | null) {
    const id = this.savedId ?? this.id.trim();
    if (!isValidId(id)) {
      this.problems = ["File name: lowercase letters, digits and hyphens, like style-guide."];
      return false;
    }
    this.saving = true;
    try {
      const content = this.content;
      const saved = await saveRules(id, { content, baseHash });
      this.savedId = id;
      this.base = { content, hash: saved.hash };
      this.conflict = null;
      this.problems = [];
      void agents.refresh();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await this.#conflicted();
      else if (error instanceof ApiError && error.status === 422) this.problems = error.message.split("\n").map((line) => line.replace(/^content: /, ""));
      else this.problems = [errorMessage(error, "Couldn't save the rules")];
      return false;
    } finally {
      this.saving = false;
    }
  }

  async #conflicted() {
    try {
      this.conflict = { disk: await this.#read(this.savedId ?? this.id.trim()) };
      this.problems = [];
    } catch (error) {
      this.problems = [errorMessage(error, "The file changed on disk, and couldn't be read again")];
    }
  }

  async #read(id: string): Promise<RulesVersion | null> {
    try {
      const response = await getRules(id);
      return { content: response.content, hash: response.hash };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }
}
