import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { unifiedMergeView } from "@codemirror/merge";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { type Compartment, EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, highlightActiveLine, keymap, placeholder, WidgetType } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { quickSwitch } from "#lib/features/search/api.ts";
import { imageFiles, imageName } from "./images.ts";
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
  /** Adds an image to the vault; resolves to its vault path. */
  readonly uploadImage: (image: File, name: string) => Promise<string>;
  /** An image couldn't be added; says why. */
  readonly onImageError: (message: string) => void;
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
  ".cm-uploading": { padding: "1px 6px", borderRadius: "999px", backgroundColor: "var(--sunken)", color: "var(--ink-3)", fontSize: "0.85em" },
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
      uploads,
      imageInput(options),
      theme,
      options.merge.of([]),
    ],
  });

const startUpload = StateEffect.define<{ readonly id: number; readonly pos: number }>();
const endUpload = StateEffect.define<number>();

class UploadingWidget extends WidgetType {
  override toDOM() {
    const span = document.createElement("span");
    span.className = "cm-uploading";
    span.textContent = "Adding image…";
    return span;
  }
  override eq() {
    return true;
  }
}

/**
 * Images on their way to the vault, each an "Adding image…" mark that moves with the
 * edits around it, so the link lands where the image was pasted. Nothing is put in
 * the text until the image is saved, so a save on idle never writes a placeholder.
 */
const uploads = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let next = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(startUpload)) {
        next = next.update({ add: [Decoration.widget({ widget: new UploadingWidget(), side: 1, id: effect.value.id }).range(effect.value.pos)] });
      } else if (effect.is(endUpload)) {
        next = next.update({ filter: (_from, _to, mark) => mark.spec.id !== effect.value });
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const uploadPosition = (state: EditorState, id: number): number | undefined => {
  let found: number | undefined;
  state.field(uploads, false)?.between(0, state.doc.length, (from, _to, mark) => {
    if (mark.spec.id === id) {
      found = from;
      return false;
    }
    return undefined;
  });
  return found;
};

let nextUpload = 0;

/**
 * Adds images to the vault and links them at `pos` (`![[Pasted image ….png]]`, the
 * shortest unambiguous target), one per line, in order. Pasted images are named by
 * time; dropped or chosen ones keep their names.
 */
export const insertImages = async (
  view: EditorView,
  files: ReadonlyArray<File>,
  pos: number,
  options: Pick<EditorOptions, "uploadImage" | "onImageError" | "vaultPaths">,
  pasted = false,
) => {
  const pending = files.map((file) => ({ file, id: nextUpload++ }));
  view.dispatch({ effects: pending.map(({ id }) => startUpload.of({ id, pos })) });
  for (const [index, { file, id }] of pending.entries()) {
    try {
      const path = await options.uploadImage(file, imageName(file, pasted, new Date()));
      const at = uploadPosition(view.state, id);
      const link = `![[${wikilinkTarget(path, [...options.vaultPaths(), path])}]]${index < pending.length - 1 ? "\n" : ""}`;
      // A cursor still where the image went moves past the link, so typing carries on after it.
      const cursor = view.state.selection.main;
      const follow = at !== undefined && cursor.empty && cursor.head === at;
      view.dispatch({
        effects: endUpload.of(id),
        ...(at === undefined ? {} : { changes: { from: at, insert: link }, userEvent: "input.paste" }),
        ...(follow ? { selection: { anchor: at + link.length } } : {}),
      });
      if (at === undefined) options.onImageError(`Added ${path}, but the note was reloaded before it could be linked.`);
    } catch (error) {
      view.dispatch({ effects: endUpload.of(id) });
      options.onImageError(`Couldn't add ${file.name || "the image"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

/** Pasting or dropping images adds them to `assets/` and links them. */
const imageInput = (options: EditorOptions): Extension =>
  EditorView.domEventHandlers({
    paste: (event, view) => {
      const files = imageFiles(event.clipboardData?.files);
      if (files.length === 0) return false;
      event.preventDefault();
      const { from, to } = view.state.selection.main;
      if (from !== to) view.dispatch({ changes: { from, to }, selection: { anchor: from } });
      void insertImages(view, files, from, options, true);
      return true;
    },
    drop: (event, view) => {
      const files = imageFiles(event.dataTransfer?.files);
      if (files.length === 0) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      void insertImages(view, files, pos, options);
      return true;
    },
  });
