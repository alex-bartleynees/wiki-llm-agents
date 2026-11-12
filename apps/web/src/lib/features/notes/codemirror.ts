import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { unifiedMergeView } from "@codemirror/merge";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { type Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { quickSwitch } from "#lib/features/search/api.ts";
import { wikilinkQuery, wikilinkTarget } from "./wikilinks.ts";

export interface EditorOptions {
  readonly vaultId: string;
  /** Every file in the vault, to keep link targets short but unambiguous. */
  readonly vaultPaths: () => ReadonlyArray<string>;
  readonly onChange: (text: string) => void;
  /** ⌘S / Ctrl S, and leaving the editor. */
  readonly onSave: () => void;
  /** Holds the conflict view (a unified merge view) while there is a conflict. */
  readonly merge: Compartment;
}

/** Markdown in the app's colours, from the design tokens, so it follows light and dark. */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "700", fontSize: "1.25em", color: "var(--ink)" },
  { tag: tags.heading2, fontWeight: "700", fontSize: "1.12em", color: "var(--ink)" },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: "700", color: "var(--ink)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--accent-ink)" },
  { tag: tags.monospace, color: "var(--ink-2)", backgroundColor: "var(--sunken)" },
  { tag: tags.quote, color: "var(--ink-2)", fontStyle: "italic" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: "var(--ink-3)" },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--accent-ink)" },
  { tag: [tags.string, tags.number, tags.bool], color: "var(--ink-2)" },
  { tag: tags.comment, color: "var(--ink-3)", fontStyle: "italic" },
]);

const theme = EditorView.theme({
  "&": { color: "var(--ink)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65" },
  ".cm-content": { padding: "12px 0 40vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 2px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--sunken) 60%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent) !important",
  },
  ".cm-placeholder": { color: "var(--ink-3)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--ink)", borderColor: "var(--line)" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "4px 8px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--ink)" },
  ".cm-completionDetail": { color: "var(--ink-3)", fontStyle: "normal", marginLeft: "8px" },
});

/**
 * Completes `[[` and `![[` links from the vault index (the quick switcher's fuzzy
 * match on titles and paths), inserting the shortest unambiguous target and the
 * closing brackets when they aren't there yet.
 */
const wikilinkCompletions =
  (options: Pick<EditorOptions, "vaultId" | "vaultPaths">): CompletionSource =>
  async (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const typed = wikilinkQuery(line.text.slice(0, context.pos - line.from));
    if (typed === undefined || typed.query.trim() === "") return null;
    const controller = new AbortController();
    context.addEventListener("abort", () => controller.abort());
    const { results } = await quickSwitch(options.vaultId, typed.query, controller.signal).catch(() => ({ results: [] }));
    const paths = options.vaultPaths();
    return {
      from: line.from + typed.from,
      filter: false,
      options: results.map((result) => {
        const target = wikilinkTarget(result.path, paths.length > 0 ? paths : results.map((other) => other.path));
        const folder = result.path.includes("/") ? result.path.slice(0, result.path.lastIndexOf("/")) : "";
        return {
          label: target,
          detail: result.title !== target.split("/").at(-1) ? result.title : folder,
          type: result.kind === "note" ? "text" : "variable",
          apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
            const closed = view.state.sliceDoc(to, to + 2) === "]]";
            view.dispatch({
              changes: { from, to, insert: closed ? target : `${target}]]` },
              selection: { anchor: from + target.length + 2 },
              userEvent: "input.complete",
            });
          },
        };
      }),
    };
  };

/** A change's two choices, named for what they keep (the library's own are "Accept" and "Reject"). */
const chunkButton = (type: "accept" | "reject", action: (event: MouseEvent) => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.name = type;
  button.textContent = type === "accept" ? "Keep mine" : "Use disk";
  button.title = type === "accept" ? "Keep your text for this change" : "Put back the text on disk for this change";
  button.onmousedown = action;
  return button;
};

/** The buttons get their own row, so on a phone they never cover the text they act on. */
const conflictTheme = EditorView.theme({
  ".cm-deletedChunk": { paddingTop: "2px" },
  ".cm-deletedChunk .cm-chunkButtons": {
    position: "static",
    display: "flex",
    justifyContent: "flex-end",
    gap: "6px",
    padding: "2px 4px 4px",
    fontFamily: "var(--font-ui)",
  },
  ".cm-deletedChunk button": { margin: "0", padding: "4px 10px", fontSize: "12px", lineHeight: "1.3" },
  ".cm-deletedChunk button[name=accept]": { background: "var(--ins)", color: "var(--on-accent)" },
  ".cm-deletedChunk button[name=reject]": { background: "var(--del)", color: "var(--on-accent)" },
});

/**
 * The conflict view: the editor's text against the version on disk (`original`), as a
 * unified diff in place, with each change kept or put back on its own.
 */
export const conflictView = (original: string): Extension => [
  unifiedMergeView({ original, mergeControls: chunkButton, gutter: true }),
  conflictTheme,
];

/** Keeps a note's line endings: a file written with CRLF is saved with CRLF. */
const lineSeparatorOf = (text: string): Extension => (text.includes("\r\n") ? EditorState.lineSeparator.of("\r\n") : []);

/** A fresh editor state for `text`: markdown (with YAML frontmatter), history, search, link completion. */
export const createEditorState = (text: string, options: EditorOptions): EditorState =>
  EditorState.create({
    doc: text,
    extensions: [
      lineSeparatorOf(text),
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      closeBrackets(),
      search({ top: true }),
      EditorView.lineWrapping,
      yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }),
      syntaxHighlighting(markdownHighlight),
      autocompletion({ override: [wikilinkCompletions(options)], icons: false }),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (options.onSave(), true) },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...defaultKeymap,
        indentWithTab,
      ]),
      placeholder("Write in markdown. Type [[ to link a note."),
      // Phone keyboards: sentence capitals and spelling, as in any text field.
      EditorView.contentAttributes.of({ "aria-label": "Note source", autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onChange(update.state.sliceDoc());
      }),
      EditorView.domEventHandlers({ blur: () => options.onSave() }),
      theme,
      options.merge.of([]),
    ],
  });
