/** A relative path that stays inside its directory: no `..`, not absolute, not empty. */
export const isInsidePath = (path: string) =>
  path !== "" && !path.startsWith("/") && !path.includes("\0") && !path.split("/").some((part) => part === ".." || part === "." || part === "");
