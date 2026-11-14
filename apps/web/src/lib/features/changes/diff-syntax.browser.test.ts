import { afterEach, describe, expect, it } from "vitest";
import { paintSyntax } from "./diff-syntax.svelte.ts";

/** The text each range of a highlight covers. */
const covered = (name: string) =>
  Array.from((CSS.highlights.get(name) ?? new Set<AbstractRange>()) as Set<AbstractRange>, (range) => {
    const live = document.createRange();
    live.setStart(range.startContainer, range.startOffset);
    live.setEnd(range.endContainer, range.endOffset);
    return live.toString();
  });

describe("paintSyntax", () => {
  afterEach(() => document.body.replaceChildren());

  it("colours a line's text across the nodes search marks split it into, and takes the colours off again", () => {
    const line = document.createElement("span");
    // `const value = "a b";` with the search match `lue = "a` marked.
    line.append("const va", Object.assign(document.createElement("mark"), { textContent: 'lue = "a' }), ' b";');
    document.body.append(line);

    const clear = paintSyntax([
      {
        element: line,
        offset: 0,
        tokens: [
          { from: 0, to: 5, style: "keyword" },
          { from: 14, to: 19, style: "string" },
        ],
      },
    ]);
    expect(covered("syntax-keyword")).toEqual(["const"]);
    expect(covered("syntax-string")).toEqual(['"a b"']);

    clear();
    expect(covered("syntax-keyword")).toEqual([]);
    expect(covered("syntax-string")).toEqual([]);
  });

  it("skips characters before the code, such as a diff sign", () => {
    const line = Object.assign(document.createElement("span"), { textContent: "+let x;" });
    document.body.append(line);
    const clear = paintSyntax([{ element: line, offset: 1, tokens: [{ from: 0, to: 3, style: "keyword" }] }]);
    expect(covered("syntax-keyword")).toEqual(["let"]);
    clear();
  });
});
