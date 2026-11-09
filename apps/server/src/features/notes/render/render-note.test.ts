import { describe, expect, it } from "vitest";
import { makeLinkIndex } from "../../../shared/markdown/link-resolution.js";
import { renderNote } from "./render-note.js";

const context = {
  path: "notes/Current.md",
  index: makeLinkIndex(["notes/Current.md", "notes/Other Note.md", "Effect 4.1.md", "assets/diagram.png", "docs/spec.pdf", "reports/Spending.html", "data/report.json"]),
  viewHref: (path: string) =>
    path.endsWith(".md") ? `/note/${path}` : path.endsWith(".html") ? `/page/${path}` : path.endsWith(".json") ? `/json/${path}` : undefined,
  fileHref: (path: string) => `/file/${path}`,
};

const render = (markdown: string) => renderNote(markdown, context);

describe("renderNote", () => {
  it("renders GFM: tables, task lists, strikethrough, autolinks", () => {
    const { html } = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~ https://example.com");
    expect(html).toContain("<table>");
    expect(html).toContain('<input type="checkbox" checked disabled>');
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">');
  });

  it("reads frontmatter, title, and tags, and keeps frontmatter out of the HTML", () => {
    const note = render("---\ntitle: Custom Title\ntags: [one, '#two']\ncreated: 2026-11-09\n---\n# Body");
    expect(note.title).toBe("Custom Title");
    expect(note.tags).toEqual(["one", "two"]);
    expect(note.frontmatter).toEqual({ title: "Custom Title", tags: ["one", "#two"], created: "2026-11-09" });
    expect(note.html).not.toContain("Custom Title");
  });

  it("falls back to the file name for the title and ignores invalid frontmatter", () => {
    const note = render("---\n: : bad: [\n---\ntext");
    expect(note.title).toBe("Current");
    expect(note.frontmatter).toEqual({});
  });

  it("splits space- or comma-separated string tags", () => {
    expect(render("---\ntags: a, b c\n---\n").tags).toEqual(["a", "b", "c"]);
  });

  it("links resolved wikilinks with aliases and headings", () => {
    const { html, links } = render("See [[Other Note]], [[Other Note|alias]], [[Other Note#Some Part]] and [[Effect 4.1]].");
    expect(html).toContain('<a href="/note/notes/Other%20Note.md" class="wikilink">Other Note</a>');
    expect(html).toContain('<a href="/note/notes/Other%20Note.md" class="wikilink">alias</a>');
    expect(html).toContain('<a href="/note/notes/Other%20Note.md#some-part" class="wikilink">Other Note > Some Part</a>');
    expect(html).toContain('<a href="/note/Effect%204.1.md" class="wikilink">Effect 4.1</a>');
    expect(links).toEqual([
      { kind: "wikilink", target: "Other Note", path: "notes/Other Note.md" },
      { kind: "wikilink", target: "Effect 4.1", path: "Effect 4.1.md" },
    ]);
  });

  it("links headings in the same note to their generated ids", () => {
    const { html } = render("## Some Part\n\n[[#Some Part]]");
    expect(html).toContain('<h2 id="some-part">Some Part</h2>');
    expect(html).toContain('<a href="#some-part" class="wikilink">Some Part</a>');
  });

  it("styles unresolved wikilinks and doesn't link them", () => {
    const { html, links } = render("[[Missing|shown]]");
    expect(html).toContain('<span class="wikilink unresolved" title="Unresolved: Missing">shown</span>');
    expect(links).toEqual([{ kind: "wikilink", target: "Missing", path: null }]);
  });

  it("embeds images with optional size, and links other embeds", () => {
    const { html, links } = render("![[diagram.png|300]] ![[diagram.png|200x100]] ![[Other Note]] ![[spec.pdf]] ![[gone.png]]");
    expect(html).toContain('<img src="/file/assets/diagram.png" alt="diagram.png" class="embed" width="300">');
    expect(html).toContain('<img src="/file/assets/diagram.png" alt="diagram.png" class="embed" width="200" height="100">');
    expect(html).toContain('<a href="/note/notes/Other%20Note.md" class="wikilink embed">Other Note</a>');
    expect(html).toContain('<a href="/file/docs/spec.pdf" class="wikilink file">spec.pdf</a>');
    expect(html).toContain('<span class="wikilink unresolved" title="Unresolved: gone.png">![[gone.png]]</span>');
    expect(links.map((link) => [link.kind, link.path])).toEqual([
      ["embed", "assets/diagram.png"],
      ["embed", "notes/Other Note.md"],
      ["embed", "docs/spec.pdf"],
      ["embed", null],
    ]);
  });

  it("links HTML files to the page view", () => {
    const { html } = render("[[Spending.html]] [report](../reports/Spending.html)");
    expect(html).toContain('<a href="/page/reports/Spending.html" class="wikilink page">Spending.html</a>');
    expect(html).toContain('<a href="/page/reports/Spending.html" class="wikilink page">report</a>');
  });

  it("links JSON files to the JSON view", () => {
    const { html } = render("[[report.json]] [data](../data/report.json)");
    expect(html).toContain('<a href="/json/data/report.json" class="wikilink json">report.json</a>');
    expect(html).toContain('<a href="/json/data/report.json" class="wikilink json">data</a>');
  });

  it("leaves wikilink syntax in code alone", () => {
    const { html, links } = render("`[[Other Note]]`\n\n```\n[[Other Note]]\n```");
    expect(html).toContain("<code>[[Other Note]]</code>");
    expect(html).not.toContain("<a ");
    expect(links).toEqual([]);
  });

  it("resolves relative markdown links and images", () => {
    const { html } = render("[other](Other%20Note.md#Some%20Part) ![d](../assets/diagram.png) [gone](nope.md)");
    expect(html).toContain('<a href="/note/notes/Other%20Note.md#some-part" class="wikilink">other</a>');
    expect(html).toContain('<img src="/file/assets/diagram.png" alt="d">');
    expect(html).toContain('<span class="wikilink unresolved" title="Unresolved: nope.md">gone</span>');
  });

  it("renders callouts with titles, default titles, folding, and nesting", () => {
    const { html } = render(
      "> [!warning] Careful **now**\n> Body text\n\n> [!note]\n> Plain\n\n> [!info]- Folded\n> Hidden\n\n> [!tip]+ Open\n> > [!agent] Inner\n> > Deep",
    );
    expect(html).toContain(
      '<div class="callout" data-callout="warning">\n<div class="callout-title">Careful <strong>now</strong></div>\n<div class="callout-content">\n<p>Body text</p>\n</div>\n</div>',
    );
    expect(html).toContain('<div class="callout-title">Note</div>');
    expect(html).toContain('<details class="callout" data-callout="info">\n<summary class="callout-title">Folded</summary>');
    expect(html).toContain('<details class="callout" data-callout="tip" open>\n<summary class="callout-title">Open</summary>');
    expect(html).toContain('<div class="callout" data-callout="agent">\n<div class="callout-title">Inner</div>');
  });

  it("keeps plain blockquotes as blockquotes", () => {
    expect(render("> just a quote").html).toBe("<blockquote>\n<p>just a quote</p>\n</blockquote>");
  });

  it("sanitises raw HTML", () => {
    const { html } = render(
      '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a><b style="color:red">bold</b><div class="app">x</div>',
    );
    expect(html).not.toMatch(/script|onerror|javascript|style=/);
    expect(html).toContain("<b>bold</b>");
  });

  it("keeps note content from forging heading ids", () => {
    const { html } = render('<h2 id="app">Forged</h2>');
    expect(html).toContain('<h2 id="forged">Forged</h2>');
  });
});
