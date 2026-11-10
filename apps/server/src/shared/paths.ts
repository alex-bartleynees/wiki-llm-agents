import { homedir } from "node:os";
import { join } from "node:path";

/** `~` and `~/…` as the home folder; any other path unchanged. */
export const expandHome = (path: string) => (path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
