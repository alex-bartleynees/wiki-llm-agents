import { homedir } from "node:os";
import { join } from "node:path";

const pathCollator = new Intl.Collator();

export const expandHome = (path: string) => (path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);

export const folderOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
};

export const comparePaths = (a: string, b: string) => pathCollator.compare(a, b);
