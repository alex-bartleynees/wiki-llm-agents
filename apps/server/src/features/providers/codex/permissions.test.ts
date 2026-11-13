import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { type Autonomy, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { autonomyConfig, decideCommand, decideFileChange, enforcedAutonomy } from "./permissions.js";
import type { FileUpdateChange } from "./protocol.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "wiki-agents-codex-permissions-")));
const vault = join(root, "vault");
const outside = join(root, "outside");
mkdirSync(join(vault, "Notes"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(vault, "Notes/Tea.md"), "# Tea\n");
symlinkSync(outside, join(vault, "escape"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const RESEARCHER: Autonomy = { read: "allow", create: "allow", edit: "ask", commands: "deny", web: "allow" };
const TRUSTED: Autonomy = { read: "allow", create: "allow", edit: "allow", commands: "allow", web: "allow" };

const add = (path: string): FileUpdateChange => ({ path, kind: { type: "add" }, diff: "x\n" });
const update = (path: string, movePath: string | null = null): FileUpdateChange => ({ path, kind: { type: "update", move_path: movePath }, diff: "@@ -1 +1 @@\n-a\n+b\n" });
const remove = (path: string): FileUpdateChange => ({ path, kind: { type: "delete" }, diff: "x\n" });

const decision = (changes: ReadonlyArray<FileUpdateChange>, autonomy: Autonomy = DEFAULT_AUTONOMY, roots = [vault]) =>
  Effect.runPromise(decideFileChange({ autonomy, roots, cwd: vault, changes }).pipe(Effect.provide(NodeFileSystem.layer)));

describe("autonomy → Codex patch decisions", () => {
  it("tells creating a file from editing one, and takes the strictest of a patch's files", async () => {
    expect(await decision([add(join(vault, "Notes/New.md"))], RESEARCHER)).toBe("allow");
    expect(await decision([update(join(vault, "Notes/Tea.md"))], RESEARCHER)).toBe("ask");
    expect(await decision([remove(join(vault, "Notes/Tea.md"))], RESEARCHER)).toBe("ask");
    expect(await decision([add(join(vault, "Notes/New.md")), update(join(vault, "Notes/Tea.md"))], RESEARCHER)).toBe("ask");
    // Adding over a file that exists replaces it: that's editing.
    expect(await decision([add(join(vault, "Notes/Tea.md"))], RESEARCHER)).toBe("ask");
    expect(await decision([add("Notes/New.md")], { ...RESEARCHER, create: "deny" })).toBe("deny");
  });

  it("asks for files outside the working folder, through a symlink out, or moved out, whatever the autonomy says", async () => {
    expect(await decision([update(join(vault, "Notes/Tea.md"))], TRUSTED)).toBe("allow");
    expect(await decision([add(join(outside, "x.md"))], TRUSTED)).toBe("ask");
    expect(await decision([add(join(vault, "escape/x.md"))], TRUSTED)).toBe("ask");
    expect(await decision([update(join(vault, "Notes/Tea.md"), join(outside, "Tea.md"))], TRUSTED)).toBe("ask");
    // A project's other directories count as inside.
    expect(await decision([add(join(outside, "x.md"))], TRUSTED, [vault, outside])).toBe("allow");
    expect(await decision([add(join(outside, "x.md"))], { ...TRUSTED, create: "deny" })).toBe("deny");
  });

  it("asks when Codex names no files", async () => {
    expect(await decision([], TRUSTED)).toBe("ask");
  });

  it("answers commands outside the sandbox from commands autonomy", () => {
    expect(decideCommand(DEFAULT_AUTONOMY)).toBe("ask");
    expect(decideCommand(RESEARCHER)).toBe("deny");
    expect(decideCommand(TRUSTED)).toBe("allow");
  });

  it("turns web search on only when the web is allowed, and says what Codex can't enforce", () => {
    expect(autonomyConfig(RESEARCHER)).toMatchObject({ web_search: "live" });
    expect(autonomyConfig(DEFAULT_AUTONOMY)).toMatchObject({ web_search: "disabled" });
    const enforced = enforcedAutonomy({ ...DEFAULT_AUTONOMY, read: "ask" });
    expect(enforced.autonomy).toEqual({ ...DEFAULT_AUTONOMY, read: "allow", web: "deny" });
    expect(enforced.notes.join("\n")).toMatch(/reading is always allowed/);
    expect(enforced.notes.join("\n")).toMatch(/can't ask before it searches the web/);
    expect(enforcedAutonomy(TRUSTED).autonomy).toEqual(TRUSTED);
  });
});
