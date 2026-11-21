import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { binaryVersion } from "./codex/cli.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

it("reads the Codex version when stdout arrives after exit", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockImplementationOnce(() => {
    queueMicrotask(() => {
      child.emit("exit", 0);
      child.stdout.end("codex-cli 0.169.0\n");
      child.stderr.end();
      child.emit("close", 0);
    });
    return child as unknown as ReturnType<typeof spawn>;
  });

  await expect(Effect.runPromise(binaryVersion("codex"))).resolves.toBe("0.169.0");
});
