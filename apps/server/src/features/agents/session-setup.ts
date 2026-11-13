import { join } from "node:path";
import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { Effect, FileSystem } from "effect";
import type { AgentSetup, Instruction } from "../providers/port.js";
import { AgentCatalog } from "./catalog.js";
import { MAX_FILE_BYTES } from "./definition.js";
import { effectiveAutonomy } from "./sources.js";

/**
 * What a thread's provider session is given for its next turn: every rules file,
 * then the agent's instructions, then the vault's own `AGENTS.md` if it has one
 * (vault-specific, so it goes last and wins), and the agent's autonomy. Without
 * an agent, the rules alone and the default autonomy (read freely, ask for the
 * rest). The web is denied to an agent whose sources leave it out. Fails with `AgentNotFound` when the thread's agent is gone or broken:
 * running it with other rules than it asked for would be a silent fallback.
 */
export const sessionSetup = Effect.fnUntraced(function* (agentId: string | null, vaultRoot: string) {
  const catalog = yield* AgentCatalog;
  const config = yield* catalog.current;
  const agent = agentId === null ? null : yield* catalog.get(agentId);
  const instructions: Array<Instruction> = config.rules.map((rules) => ({
    source: "rules",
    title: `rules/${rules.id}.md`,
    path: rules.path,
    text: rules.text,
  }));
  if (agent !== null) {
    const intro = `You are the ${agent.name} agent${agent.description === "" ? "." : `: ${agent.description}`}`;
    instructions.push({ source: "agent", title: `${agent.name} agent (agents/${agent.id}.md)`, path: agent.path, text: `${intro}\n\n${agent.instructions}` });
  }
  const vaultRules = yield* readVaultRules(vaultRoot);
  if (vaultRules !== null) instructions.push(vaultRules);
  const setup: AgentSetup = { instructions, autonomy: agent === null ? DEFAULT_AUTONOMY : effectiveAutonomy(agent) };
  return setup;
});

/** The vault's `AGENTS.md`, if it has a readable one of a sensible size. */
const readVaultRules = (vaultRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = join(vaultRoot, "AGENTS.md");
    const info = yield* fs.stat(path);
    if (info.type !== "File") return null;
    if (Number(info.size) > MAX_FILE_BYTES) {
      yield* Effect.logWarning(`${path} is over ${MAX_FILE_BYTES / 1024} KiB; not passed to providers that don't read it themselves`);
      return null;
    }
    const instruction: Instruction = { source: "vault", title: "AGENTS.md in the vault", path, text: yield* fs.readFileString(path) };
    return instruction;
  }).pipe(Effect.catchTag("PlatformError", () => Effect.succeed(null)));
