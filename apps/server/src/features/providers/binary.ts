import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { Effect } from "effect";
import { ProviderError } from "./port.js";

/** `binary` as an absolute path: as given when it has a slash, else the first match on `PATH`. */
export const resolveBinary = (binary: string): string | undefined => {
  const executable = (path: string) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (binary.includes("/")) {
    const path = resolve(binary);
    return executable(path) ? path : undefined;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir !== "" && executable(join(dir, binary))) return join(dir, binary);
  }
  return undefined;
};

/** Runs `binary args...` to the end; its stdout, or why it failed (`notInstalled` when there is no such binary). */
export const runBinary = (binary: string, args: ReadonlyArray<string>, notInstalled: string) =>
  Effect.callback<string, ProviderError>((resume) => {
    const child = spawn(binary, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString("utf8");
    });
    child.once("error", (cause) =>
      resume(Effect.fail(new ProviderError({ message: "code" in cause && cause.code === "ENOENT" ? notInstalled : cause.message, cause }))),
    );
    child.once("exit", (code) =>
      resume(
        code === 0 || output.trim() !== ""
          ? Effect.succeed(output)
          : Effect.fail(new ProviderError({ message: `"${binary} ${args.join(" ")}" failed: ${errors.trim() || `exit code ${code}`}` })),
      ),
    );
    return Effect.sync(() => child.kill());
  });
