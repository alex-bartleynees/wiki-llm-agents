import { goto } from "$app/navigation";
import { page } from "$app/state";

export const wikiAgentsDestination = (url: { readonly origin: string; readonly searchParams: Pick<URLSearchParams, "get"> }) => {
  const from = url.searchParams.get("from");
  if (!from?.startsWith("/") || from.startsWith("//") || from.includes("\\")) return null;
  const target = new URL(from, url.origin);
  const wikiPath = target.pathname === "/" || /^\/(vaults|settings)(\/|$)/.test(target.pathname);
  return target.origin === url.origin && wikiPath ? target.pathname + target.search + target.hash : null;
};

export const agentEditorHref = (editor: "edit" | "rules", id: string | null, from: string | null) => {
  const params = new URLSearchParams();
  if (id !== null) params.set(editor === "edit" ? "agent" : "rules", id);
  if (from !== null) params.set("from", from);
  return `/agents/${editor}${params.size ? `?${params}` : ""}`;
};

export const editorExit = () => () => {
  void goto(wikiAgentsDestination(page.url) ?? "/agents", { replaceState: true });
};
