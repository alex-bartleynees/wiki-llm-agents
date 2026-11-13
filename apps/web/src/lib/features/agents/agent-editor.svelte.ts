import type { AgentInput, Autonomy } from "@wiki-agents/contracts/agents/model";
import { ApiError, errorMessage } from "#lib/api/client.ts";
import { BLANK_AGENT, changedFields, type FormField, idFromName, inputFromAgent, problemsByField } from "./agent-form.ts";
import { agents } from "./agents.svelte.ts";
import { deleteAgent, getAgent, saveAgent } from "./api.ts";

/** A version of the agent's file: what it says, and the hash of its bytes. */
export interface AgentVersion {
  readonly input: AgentInput;
  readonly hash: string;
}

/**
 * The file changed on disk since the edit started (Syncthing, a hand edit): `disk`
 * is what it says now, or null when it has been deleted.
 */
export interface AgentConflict {
  readonly disk: AgentVersion | null;
}

/** The form's fields, which the inputs change one at a time. */
export type AgentForm = { -readonly [K in keyof AgentInput]: K extends "autonomy" ? { -readonly [A in keyof Autonomy]: Autonomy[A] } : AgentInput[K] };

const copy = (input: AgentInput): AgentForm => structuredClone($state.snapshot(input) as AgentForm);

/**
 * One agent being edited (or created, with `agentId` null): the form, the version
 * it started from, and saving. Saves are explicit and hash-checked; a file that
 * changed meanwhile becomes a conflict to resolve, never overwritten unasked.
 */
export class AgentEditor {
  /** The id the file is saved under; null until a new agent is first saved. */
  savedId = $state<string | null>(null);
  /** The id a new agent will get: follows the name until edited by hand. */
  id = $state("");
  form = $state<AgentForm>(copy(BLANK_AGENT));
  status = $state<"loading" | "ready" | "missing" | "failed">("ready");
  loadError = $state<string | undefined>(undefined);
  saving = $state(false);
  problems = $state<Partial<Record<FormField, ReadonlyArray<string>>>>({});
  conflict = $state<AgentConflict | null>(null);
  base = $state<AgentVersion | null>(null);
  #idEdited = false;

  constructor(agentId: string | null) {
    if (agentId !== null) {
      this.savedId = agentId;
      this.id = agentId;
      this.status = "loading";
    }
  }

  get isNew() {
    return this.savedId === null;
  }

  /** Fields changed from the version the edit started from. */
  get changed(): ReadonlyArray<keyof AgentInput> {
    return changedFields(this.base?.input ?? BLANK_AGENT, this.form);
  }

  get dirty() {
    return this.changed.length > 0;
  }

  async load() {
    if (this.savedId === null) return;
    try {
      const version = await this.#read(this.savedId);
      if (version === null) {
        this.status = "missing";
        return;
      }
      this.#take(version);
      this.status = "ready";
    } catch (error) {
      this.status = "failed";
      this.loadError = errorMessage(error, "Couldn't load the agent");
    }
  }

  setName(name: string) {
    this.form.name = name;
    if (this.isNew && !this.#idEdited) this.id = idFromName(name);
  }

  setId(id: string) {
    this.#idEdited = true;
    this.id = id;
  }

  /** Saves over the version the edit started from; true when saved. */
  save() {
    return this.#save(this.base?.hash ?? null);
  }

  /** Resolves a conflict by saving this form over what is on disk now. */
  keepMine() {
    return this.#save(this.conflict?.disk?.hash ?? null);
  }

  /** Resolves a conflict by taking what is on disk, dropping this form's changes. */
  useDisk() {
    const disk = this.conflict?.disk;
    if (disk === undefined) return;
    if (disk === null) {
      this.base = null;
      this.savedId = null;
    } else {
      this.#take(disk);
    }
    this.conflict = null;
    this.problems = {};
  }

  /** Moves the file to the config trash, if it is still the version loaded; true when done. */
  async remove() {
    if (this.savedId === null || this.base === null) return false;
    this.saving = true;
    try {
      await deleteAgent(this.savedId, this.base.hash);
      void agents.refresh();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await this.#conflicted();
      else this.problems = { form: [errorMessage(error, "Couldn't delete the agent")] };
      return false;
    } finally {
      this.saving = false;
    }
  }

  async #save(baseHash: string | null) {
    const id = this.savedId ?? this.id;
    this.saving = true;
    try {
      const saved = await saveAgent(id, { agent: copy(this.form), baseHash });
      this.savedId = id;
      this.#take({ input: inputFromAgent(saved.agent, saved.instructions), hash: saved.hash });
      this.conflict = null;
      this.problems = {};
      void agents.refresh();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await this.#conflicted();
      else if (error instanceof ApiError && error.status === 422) this.problems = problemsByField(error.message);
      else this.problems = { form: [errorMessage(error, "Couldn't save the agent")] };
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** Reads what is on disk now and shows it as a conflict with this form. */
  async #conflicted() {
    const id = this.savedId ?? this.id;
    try {
      this.conflict = { disk: await this.#read(id) };
      this.problems = {};
    } catch (error) {
      this.problems = { form: [errorMessage(error, "The file changed on disk, and couldn't be read again")] };
    }
  }

  async #read(id: string): Promise<AgentVersion | null> {
    try {
      const response = await getAgent(id);
      return { input: inputFromAgent(response.agent, response.instructions), hash: response.hash };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  #take(version: AgentVersion) {
    this.base = { input: copy(version.input), hash: version.hash };
    this.form = copy(version.input);
  }
}
