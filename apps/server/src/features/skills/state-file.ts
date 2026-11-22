import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { info, readRegular } from "./bundle.js";

export function readJson(path: string): unknown {
  if (!info(path)) return null;
  return JSON.parse(readRegular(path, 128 * 1024).bytes.toString("utf8")) as unknown;
}

export function writeAtomic(path: string, content: string, mode = 0o600) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, content, { flag: "wx", mode });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
