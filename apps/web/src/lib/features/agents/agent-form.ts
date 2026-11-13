import { type AgentInput, type AgentSummary, DEFAULT_AUTONOMY, type KnowledgeSource } from "@wiki-agents/contracts/agents/model";

/** What a new agent starts as: read freely, ask for the rest, no limits on sources. */
export const BLANK_AGENT: AgentInput = {
  name: "",
  description: "",
  provider: null,
  model: null,
  sources: [],
  autonomy: DEFAULT_AUTONOMY,
  instructions: "",
};

/** The file name for a new agent: `Code Reviewer` → `code-reviewer`. */
export const idFromName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The id the server accepts (`ID_PATTERN` there). */
export const isValidId = (id: string) => /^[a-z0-9][a-z0-9-]*$/.test(id);

export const inputFromAgent = (agent: AgentSummary, instructions: string): AgentInput => ({
  name: agent.name,
  description: agent.description,
  provider: agent.provider,
  model: agent.model,
  sources: agent.sources,
  autonomy: agent.autonomy,
  instructions,
});

export type FormField = keyof AgentInput | "id" | "form";

/**
 * A 422's lines (`sources.0.folders.0: …`) by the form field they belong to (the
 * first segment); lines naming no field go under `form`.
 */
export const problemsByField = (message: string): Partial<Record<FormField, ReadonlyArray<string>>> => {
  const fields: Partial<Record<FormField, Array<string>>> = {};
  for (const line of message.split("\n").filter((line) => line.trim() !== "")) {
    const match = /^([a-zA-Z]+)[\w.]*: (.*)$/.exec(line);
    const field = (match?.[1] ?? "form") as FormField;
    const known = field === "id" || field === "form" || field in BLANK_AGENT;
    (fields[known ? field : "form"] ??= []).push(known && match ? match[2]! : line);
  }
  return fields;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields that differ between two versions of an agent, in form order. */
export const changedFields = (a: AgentInput, b: AgentInput): ReadonlyArray<keyof AgentInput> =>
  (Object.keys(BLANK_AGENT) as Array<keyof AgentInput>).filter((field) => !same(a[field], b[field]));

/** `vault`, `web`, `Notes`, `Notes: Projects, Areas`. */
export const describeSource = (source: KnowledgeSource) =>
  source === "vault" ? "The thread's vault" : source === "web" ? "The web" : source.folders.length === 0 ? source.vault : `${source.vault}: ${source.folders.join(", ")}`;

export const describeSources = (sources: ReadonlyArray<KnowledgeSource>) =>
  sources.length === 0 ? "Any vault and the web (no limits)" : sources.map(describeSource).join(" · ");
