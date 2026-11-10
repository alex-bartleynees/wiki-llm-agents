import { AUTONOMY_ACTIONS, type Autonomy, type AutonomyAction, type AutonomyLevel, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import type { AgentSummary } from "@wiki-agents/contracts/agents/model";

export const ACTION_LABEL: Readonly<Record<AutonomyAction, string>> = {
  read: "Read files",
  create: "Create files",
  edit: "Edit existing files",
  commands: "Run commands",
  web: "Use the web",
};

export const LEVEL_LABEL: Readonly<Record<AutonomyLevel, string>> = { allow: "Allowed", ask: "Asks first", deny: "Never" };

/** Each action as "reads files", "reading files", and "read files". */
const PHRASES: Readonly<Record<AutonomyAction, readonly [string, string, string]>> = {
  read: ["reads files", "reading files", "read files"],
  create: ["creates files", "creating files", "create files"],
  edit: ["edits files", "editing files", "edit files"],
  commands: ["runs commands", "running commands", "run commands"],
  web: ["uses the web", "using the web", "use the web"],
};

const list = (items: ReadonlyArray<string>, conjunction = "and") =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;

/** "It reads files and uses the web without asking; asks before creating files and editing files; won't run commands." */
export const describeAutonomy = (autonomy: Autonomy) => {
  const by = (level: AutonomyLevel, form: 0 | 1 | 2) =>
    AUTONOMY_ACTIONS.filter((action) => autonomy[action] === level).map((action) => PHRASES[action][form]);
  const parts = [
    ...(by("allow", 0).length > 0 ? [`${list(by("allow", 0))} without asking`] : []),
    ...(by("ask", 1).length > 0 ? [`asks before ${list(by("ask", 1))}`] : []),
    ...(by("deny", 2).length > 0 ? [`won't ${list(by("deny", 2), "or")}`] : []),
  ];
  return `It ${parts.join("; ")}.`;
};

/** What the provider will actually enforce for the agent (or for no agent), when it says. */
export const enforcedAutonomy = (agent: AgentSummary | undefined, providerInstanceId: string | undefined): Autonomy | null => {
  if (agent === undefined) return DEFAULT_AUTONOMY;
  const enforcement = agent.enforcement.find((entry) => entry.providerInstanceId === providerInstanceId);
  return enforcement === undefined ? agent.autonomy : enforcement.autonomy;
};
