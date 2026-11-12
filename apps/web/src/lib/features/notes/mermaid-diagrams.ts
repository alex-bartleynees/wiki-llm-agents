let nextId = 0;
const renderer = () => import("mermaid").then(({ default: mermaid }) => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
  });
  return mermaid;
});

/** Enhance only fenced Mermaid blocks; ordinary code remains untouched. */
export function mermaidDiagrams(node: HTMLElement) {
  let disposed = false;
  const blocks = [...node.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  if (blocks.length > 0) void (async () => {
    for (const code of blocks) {
      if (disposed) return;
      const pre = code.parentElement!;
      const figure = document.createElement("figure");
      figure.className = "mermaid-diagram";
      const output = document.createElement("div");
      const source = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Diagram source";
      source.append(summary);
      pre.replaceWith(figure);
      source.append(pre);
      figure.append(output, source);
      try {
        const mermaid = await renderer();
        if (disposed) return;
        const { svg } = await mermaid.render(`vault-mermaid-${++nextId}`, code.textContent ?? "");
        if (disposed) return;
        output.innerHTML = svg;
      } catch {
        if (disposed) return;
        output.textContent = "Could not render this Mermaid diagram. Check its source.";
        output.setAttribute("role", "status");
        source.open = true;
      }
    }
  })();
  return { destroy() { disposed = true; } };
}
